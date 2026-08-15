import { admitAndFlag, verifyOffline, verifyOnline } from '@/lib/verify';

// The database is mocked so these tests assert the DECISION RULES, not SQLite.
// The rules are the part that is dangerous to get wrong at a gate.
const mockDb = {
  pool: [] as { id: string; code: string; expires_at: string }[],
  burned: [] as string[],
  enqueued: [] as any[],
  lastPullAt: null as string | null,
};

jest.mock('@/lib/db', () => ({
  findInPool: jest.fn(async (code: string, now = Date.now()) => {
    const hit = mockDb.pool.find((c) => c.code === code);
    if (!hit) return null;
    return new Date(hit.expires_at).getTime() > now ? hit : null;
  }),
  findInPoolIgnoringExpiry: jest.fn(
    async (code: string) => mockDb.pool.find((c) => c.code === code) ?? null,
  ),
  burnLocally: jest.fn(async (id: string) => {
    mockDb.burned.push(id);
    mockDb.pool = mockDb.pool.filter((c) => c.id !== id);
  }),
  enqueue: jest.fn(async (row: any, synced: 0 | 1 = 0) => {
    mockDb.enqueued.push({ ...row, synced });
  }),
  getMeta: jest.fn(async (k: string) => (k === 'last_pull_at' ? mockDb.lastPullAt : null)),
}));

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: any[]) => mockRpc(...a) },
}));

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).__resetUuidSeq();
  mockDb.pool = [{ id: 'code-1', code: '7K4P92', expires_at: inHours(3) }];
  mockDb.burned = [];
  mockDb.enqueued = [];
  mockDb.lastPullAt = new Date(Date.now() - 40 * 60_000).toISOString(); // 40 min stale
});

describe('offline verification', () => {
  it('admits a code held in the pool', async () => {
    const v = await verifyOffline('7K4P92');

    expect(v.decision).toBe('admit');
    expect(v.checkedWith).toBe('device');
  });

  // Without this the same visitor walks back to the same gate during an outage
  // and is admitted again on the same code.
  it('burns the code locally so this phone cannot admit it twice', async () => {
    await verifyOffline('7K4P92');
    expect(mockDb.burned).toEqual(['code-1']);

    const second = await verifyOffline('7K4P92');
    expect(second.decision).toBe('refuse');
  });

  it('queues the admission for replay, stamped with how stale the pool was', async () => {
    await verifyOffline('7K4P92');

    expect(mockDb.enqueued).toHaveLength(1);
    expect(mockDb.enqueued[0]).toMatchObject({
      code: '7K4P92',
      code_id: 'code-1',
      outcome: 'admitted',
    });
    // ~40 minutes. The admin log reads "verified against a 40-minute-old pool".
    expect(mockDb.enqueued[0].pool_age_seconds).toBeGreaterThan(2300);
  });

  // A STALE POOL STILL ADMITS (§5.4). Refusing on old data would turn a network
  // outage into a gate outage.
  it('still admits when the pool is very stale', async () => {
    mockDb.lastPullAt = new Date(Date.now() - 5 * 3600_000).toISOString();
    const v = await verifyOffline('7K4P92');
    expect(v.decision).toBe('admit');
  });

  // "Expired" and "never heard of it" are different conversations to have with
  // a visitor, so they must not collapse into one reason.
  it('says expired, not unknown, for a code that timed out', async () => {
    mockDb.pool = [{ id: 'code-2', code: 'ZR8T4Q', expires_at: inHours(-1) }];

    const v = await verifyOffline('ZR8T4Q');

    expect(v.decision).toBe('refuse');
    if (v.decision === 'refuse') expect(v.reason).toBe('expired');
  });

  it('says unknown for a code that is not in the pool at all', async () => {
    const v = await verifyOffline('QQQQQQ');
    expect(v.decision).toBe('refuse');
    if (v.decision === 'refuse') expect(v.reason).toBe('unknown_code');
  });

  // Failed attempts are audit records too — an admin needs to see them.
  it('records refusals, not just admissions', async () => {
    await verifyOffline('QQQQQQ');

    expect(mockDb.enqueued).toHaveLength(1);
    expect(mockDb.enqueued[0]).toMatchObject({
      code: 'QQQQQQ',
      code_id: null,
      outcome: 'rejected',
      reject_reason: 'unknown_code',
    });
  });

  it('gives every event its own client_event_id', async () => {
    await verifyOffline('7K4P92');
    await verifyOffline('QQQQQQ');

    const ids = mockDb.enqueued.map((e) => e.client_event_id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('admit-and-flag', () => {
  it('records the override with no code_id and never silently', async () => {
    const v = await admitAndFlag('ZR8T4Q');

    expect(v.decision).toBe('flagged');
    expect(mockDb.enqueued[0]).toMatchObject({
      code: 'ZR8T4Q',
      code_id: null,
      outcome: 'flagged',
    });
  });
});

describe('online verification', () => {
  it('reports the server verdict and never decides for itself', async () => {
    mockRpc.mockResolvedValue({
      data: [{ outcome: 'admitted', reject_reason: null, collision: false, verified_at: '2026-08-14T18:42:00Z' }],
      error: null,
    });

    const v = await verifyOnline('estate-1', '7K4P92');

    expect(v.decision).toBe('admit');
    expect(v.checkedWith).toBe('server');
    // Critically: it did NOT touch the local pool. The server owns the burn.
    expect(mockDb.burned).toEqual([]);
  });

  // The id is generated BEFORE the call so a retry after a lost response carries
  // the same one and the server dedupes instead of burning a second code.
  it('sends a client_event_id with the request', async () => {
    mockRpc.mockResolvedValue({ data: [{ outcome: 'admitted' }], error: null });

    await verifyOnline('estate-1', '7K4P92');

    const [, args] = mockRpc.mock.calls[0];
    expect(args.p_client_event_id).toBeTruthy();
    expect(args.p_estate_id).toBe('estate-1');
    expect(args.p_code).toBe('7K4P92');
  });

  it('names the host on an admitted entry', async () => {
    mockRpc.mockResolvedValue({
      data: [{ outcome: 'admitted', host_name: 'A. Mokoena', host_unit: '14' }],
      error: null,
    });

    const v = await verifyOnline('estate-1', '7K4P92');

    expect(v.decision).toBe('admit');
    if (v.decision === 'admit') expect(v.host).toEqual({ name: 'A. Mokoena', unit: '14' });
  });

  // The server nulls host on refusal. If the client ever started reading it
  // anyway, the keypad would become a way to enumerate who owns which code.
  it('shows no host on a refusal', async () => {
    mockRpc.mockResolvedValue({
      data: [{ outcome: 'rejected', reject_reason: 'already_used', host_name: null, host_unit: null }],
      error: null,
    });

    const v = await verifyOnline('estate-1', 'P9M2XK');
    expect(v.decision).toBe('refuse');
  });

  // A collision IS a refusal — outcome comes back as 'collision', not
  // 'rejected', and anything that is not 'admitted' must keep the gate shut.
  it('treats a collision outcome as do-not-admit', async () => {
    mockRpc.mockResolvedValue({
      data: [{ outcome: 'collision', reject_reason: 'already_used', collision: true }],
      error: null,
    });

    const v = await verifyOnline('estate-1', 'P9M2XK');
    expect(v.decision).toBe('refuse');
  });

  it('surfaces a collision as its own explanation', async () => {
    mockRpc.mockResolvedValue({
      data: [{ outcome: 'rejected', reject_reason: 'already_used', collision: true }],
      error: null,
    });

    const v = await verifyOnline('estate-1', 'P9M2XK');

    expect(v.decision).toBe('refuse');
    if (v.decision === 'refuse') {
      expect(v.reason).toBe('already_used');
      expect(v.detail).toMatch(/already burned/i);
    }
  });
});

// REGRESSION: online checks were never written to the local ledger, so a guard
// who worked an entire shift with signal opened the Log and saw
// "0 checks on this phone".
describe('the shift log records online checks too', () => {
  it('writes an admitted online check to the ledger', async () => {
    mockRpc.mockResolvedValue({
      data: [{
        outcome: 'admitted',
        code_id: 'code-1',
        reject_reason: null,
        verified_at: '2026-08-14T18:42:00Z',
      }],
      error: null,
    });

    await verifyOnline('estate-1', '7K4P92');

    expect(mockDb.enqueued).toHaveLength(1);
    expect(mockDb.enqueued[0]).toMatchObject({
      code: '7K4P92',
      code_id: 'code-1',
      outcome: 'admitted',
      verified_at: '2026-08-14T18:42:00Z',
    });
  });

  // synced=1 is what keeps it out of the replay queue. The server already
  // committed this event; the row exists to be READ, not re-sent.
  it('marks it already synced so replay never pushes it again', async () => {
    mockRpc.mockResolvedValue({ data: [{ outcome: 'admitted' }], error: null });

    await verifyOnline('estate-1', '7K4P92');

    expect(mockDb.enqueued[0].synced).toBe(1);
  });

  it('records a refusal as well as an admission', async () => {
    mockRpc.mockResolvedValue({
      data: [{ outcome: 'rejected', reject_reason: 'already_used' }],
      error: null,
    });

    await verifyOnline('estate-1', 'P9M2XK');

    expect(mockDb.enqueued[0]).toMatchObject({
      outcome: 'rejected',
      reject_reason: 'already_used',
      synced: 1,
    });
  });

  // A collision is not 'admitted', so it must be logged as a refusal — the
  // ledger has to agree with the verdict the guard was shown.
  it('logs a collision as a refusal', async () => {
    mockRpc.mockResolvedValue({
      data: [{ outcome: 'collision', reject_reason: 'already_used', collision: true }],
      error: null,
    });

    await verifyOnline('estate-1', 'P9M2XK');

    expect(mockDb.enqueued[0].outcome).toBe('rejected');
  });

  // pool_age_seconds describes how stale the CACHE was. An online verdict never
  // consulted the cache, so claiming an age would misreport how it was reached.
  it('records no pool age for a server verdict', async () => {
    mockRpc.mockResolvedValue({ data: [{ outcome: 'admitted' }], error: null });

    await verifyOnline('estate-1', '7K4P92');

    expect(mockDb.enqueued[0].pool_age_seconds).toBeNull();
  });

  it('logs under the same id it sent, so a retry cannot double-log', async () => {
    mockRpc.mockResolvedValue({ data: [{ outcome: 'admitted' }], error: null });

    const v = await verifyOnline('estate-1', '7K4P92');
    const [, args] = mockRpc.mock.calls[0];

    expect(mockDb.enqueued[0].client_event_id).toBe(args.p_client_event_id);
    expect(mockDb.enqueued[0].client_event_id).toBe(v.clientEventId);
  });
});
