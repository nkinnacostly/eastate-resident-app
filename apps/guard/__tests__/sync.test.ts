import { pull, push, syncNow } from '@/lib/sync';

const state = {
  cursor: '0',
  queue: [] as any[],
  marked: [] as string[],
  pulls: [] as { upserts: any[]; tombstones: string[]; cursor: number }[],
};

jest.mock('@/lib/db', () => ({
  getMeta: jest.fn(async (k: string) => (k === 'cursor' ? state.cursor : null)),
  setMeta: jest.fn(async () => {}),
  applyPull: jest.fn(async (upserts: any[], tombstones: string[], cursor: number) => {
    state.pulls.push({ upserts, tombstones, cursor });
    state.cursor = String(cursor);
  }),
  unsynced: jest.fn(async () => state.queue),
  markSynced: jest.fn(async (ids: string[]) => {
    state.marked.push(...ids);
  }),
}));

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: any[]) => mockRpc(...a) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  state.cursor = '0';
  state.queue = [];
  state.marked = [];
  state.pulls = [];
});

describe('pull', () => {
  it('advances the server-owned cursor rather than using a device clock', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { upserts: [{ id: 'a', code: 'AAAAAA', expires_at: 'x' }], tombstones: [], cursor: 12 },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: { upserts: [], tombstones: [], cursor: 12 }, error: null });

    await pull('estate-1');

    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_cursor: 0 });
    expect(mockRpc.mock.calls[1][1]).toMatchObject({ p_cursor: 12 });
  });

  // sync_pull pages at 500 rows, so a device that has been off a long time
  // needs several passes or its pool silently stops at the first page.
  it('keeps paging until the server has nothing past the cursor', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: { upserts: [{ id: 'a' }], tombstones: [], cursor: 1 }, error: null })
      .mockResolvedValueOnce({ data: { upserts: [{ id: 'b' }], tombstones: [], cursor: 2 }, error: null })
      .mockResolvedValueOnce({ data: { upserts: [], tombstones: [], cursor: 2 }, error: null });

    const applied = await pull('estate-1');

    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(applied).toBe(2);
  });

  // An additive-only feed can never tell a device a code was revoked.
  it('applies tombstones, not just upserts', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { upserts: [], tombstones: ['gone-1', 'gone-2'], cursor: 9 },
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: { upserts: [], tombstones: [], cursor: 9 }, error: null });

    await pull('estate-1');

    expect(state.pulls[0].tombstones).toEqual(['gone-1', 'gone-2']);
  });
});

describe('push', () => {
  it('does nothing when the outbox is empty', async () => {
    const r = await push('estate-1');
    expect(r).toEqual({ pushed: 0, collisions: 0 });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // An event dropped here is an audit record that exists nowhere else, so only
  // rows the server actually acknowledged may be marked synced.
  it('marks only the events the server acknowledged', async () => {
    state.queue = [
      { client_event_id: 'e1', code: 'A', code_id: null, verified_at: 't', pool_age_seconds: 1 },
      { client_event_id: 'e2', code: 'B', code_id: null, verified_at: 't', pool_age_seconds: 1 },
    ];
    // The server returns only e1.
    mockRpc.mockResolvedValue({ data: [{ client_event_id: 'e1', collision: false }], error: null });

    const r = await push('estate-1');

    expect(r.pushed).toBe(1);
    expect(state.marked).toEqual(['e1']);
    expect(state.marked).not.toContain('e2');
  });

  it('counts collisions so they can be surfaced, never dropped', async () => {
    state.queue = [{ client_event_id: 'e1', code: 'A', code_id: null, verified_at: 't', pool_age_seconds: null }];
    mockRpc.mockResolvedValue({ data: [{ client_event_id: 'e1', collision: true }], error: null });

    const r = await push('estate-1');

    expect(r.collisions).toBe(1);
  });
});

describe('syncNow ordering', () => {
  // Pulling first would hand back the very code we just burned offline as live.
  it('pushes before it pulls', async () => {
    const order: string[] = [];
    state.queue = [{ client_event_id: 'e1', code: 'A', code_id: null, verified_at: 't', pool_age_seconds: null }];

    mockRpc.mockImplementation(async (fn: string) => {
      order.push(fn);
      if (fn === 'ingest_verification_events') {
        return { data: [{ client_event_id: 'e1', collision: false }], error: null };
      }
      return { data: { upserts: [], tombstones: [], cursor: 0 }, error: null };
    });

    await syncNow('estate-1');

    expect(order[0]).toBe('ingest_verification_events');
    expect(order[1]).toBe('sync_pull');
  });
});
