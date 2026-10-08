import {
  bindSession,
  clearPool,
  countStranded,
  countUnsynced,
  enqueue,
  forgetPost,
  getMeta,
  recallPost,
  rememberPost,
  setMeta,
  unsynced,
  __resetDbForTests,
} from '@/lib/db';

/**
 * A recording stand-in for expo-sqlite.
 *
 * It understands only the handful of statements db.ts actually issues against
 * `meta`, and records everything else verbatim. That split is deliberate: the
 * invariant under test is "the cursor is deleted together with the pool rows",
 * and asserting on the statements is a truer test of that than re-implementing
 * SQLite well enough to be fooled by the same bug.
 */
const sql = {
  meta: new Map<string, string>(),
  statements: [] as string[],
  calls: [] as { sql: string; args: unknown[] }[],
  inTransaction: [] as string[],
  depth: 0,
};

const mockDb = {
  execAsync: jest.fn(async (s: string) => {
    sql.statements.push(s.trim());
  }),
  runAsync: jest.fn(async (s: string, ...args: unknown[]) => {
    const q = s.trim().replace(/\s+/g, ' ');
    sql.statements.push(q);
    sql.calls.push({ sql: q, args });
    if (sql.depth > 0) sql.inTransaction.push(q);
    if (q.startsWith('INSERT INTO meta')) sql.meta.set(args[0] as string, args[1] as string);
    else if (q.startsWith("DELETE FROM meta WHERE key = 'cursor'")) sql.meta.delete('cursor');
    else if (q.startsWith('DELETE FROM meta WHERE key = ?')) sql.meta.delete(args[0] as string);
  }),
  getFirstAsync: jest.fn(async (s: string, ...args: unknown[]) => {
    sql.calls.push({ sql: s.trim().replace(/\s+/g, ' '), args });
    if (s.includes('FROM meta')) {
      const key = args[0] as string;
      return sql.meta.has(key) ? { value: sql.meta.get(key) } : null;
    }
    return null;
  }),
  getAllAsync: jest.fn(async (s: string, ...args: unknown[]) => {
    sql.calls.push({ sql: s.trim().replace(/\s+/g, ' '), args });
    // Satisfies the membership_id column probe in getDb(): the schema this
    // fake stands in for is the current one, so no ALTER is expected.
    if (s.includes('table_info')) return [{ name: 'membership_id' }];
    return [];
  }),
  withTransactionAsync: jest.fn(async (cb: () => Promise<void>) => {
    sql.depth++;
    try {
      await cb();
    } finally {
      sql.depth--;
    }
  }),
};

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));

beforeEach(() => {
  jest.clearAllMocks();
  __resetDbForTests();
  sql.meta.clear();
  sql.statements = [];
  sql.calls = [];
  sql.inTransaction = [];
  sql.depth = 0;
});

describe('clearPool', () => {
  // The bug this exists for: DELETE FROM pool alone left the cursor at its
  // high-water mark, so sync_pull (sync_seq > cursor) returned only codes
  // minted after the handover. Every still-valid code from before it was
  // invisible to the incoming guard's phone for the rest of its 6h life.
  it('drops the sync cursor along with the rows', async () => {
    await setMeta('cursor', '4210');

    await clearPool();

    expect(await getMeta('cursor')).toBeNull();
  });

  // Half-applied, the phone is in exactly the broken state above — so the two
  // deletes must not be able to come apart.
  it('deletes rows and cursor in one transaction', async () => {
    await clearPool();

    expect(mockDb.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(sql.inTransaction).toEqual([
      'DELETE FROM pool',
      "DELETE FROM meta WHERE key = 'cursor'",
    ]);
  });

  it('leaves the outbox alone — it is a ledger, not a cache', async () => {
    await clearPool();

    expect(sql.statements.filter((s) => /DELETE.*outbox/i.test(s))).toEqual([]);
  });
});

describe('bindSession', () => {
  it('keeps the cache when the estate is unchanged', async () => {
    await bindSession('estate-a', 'm-1');
    sql.statements = [];
    await setMeta('cursor', '99');

    const wiped = await bindSession('estate-a', 'm-1');

    expect(wiped).toBe(false);
    expect(await getMeta('cursor')).toBe('99');
    expect(sql.statements).not.toContain('DELETE FROM pool');
  });

  // The one that matters. A gate phone that was force-quit rather than signed
  // out still holds the previous estate's codes, and findInPool matches on the
  // typed code alone — there is no estate_id on a pool row to save us.
  it('wipes a cache that was filled for a different estate', async () => {
    await bindSession('estate-a', 'm-1');
    await setMeta('cursor', '99');
    sql.statements = [];

    const wiped = await bindSession('estate-b', 'm-1');

    expect(wiped).toBe(true);
    expect(sql.statements).toContain('DELETE FROM pool');
    expect(await getMeta('cursor')).toBeNull();
    expect(await getMeta('pool_estate_id')).toBe('estate-b');
  });

  // A fresh install has no pool to protect, and wiping would be a pointless
  // extra transaction on the slowest path the app has (first launch).
  it('does not wipe on a first bind', async () => {
    const wiped = await bindSession('estate-a', 'm-1');

    expect(wiped).toBe(false);
    expect(sql.statements).not.toContain('DELETE FROM pool');
    expect(await getMeta('pool_estate_id')).toBe('estate-a');
  });
});

/**
 * The outbox is a LEDGER of decisions particular people made.
 *
 * ingest_verification_events derives the actor from auth.uid() — it must, since
 * a client-supplied membership id would be a forged identity — so whoever is
 * signed in when a queued row is pushed is the name the server records against
 * it. That makes "whose row is this" a question the phone has to answer before
 * it pushes, and these tests are that answer.
 */
describe('outbox attribution', () => {
  const lastCallMatching = (needle: string) =>
    [...sql.calls].reverse().find((c) => c.sql.includes(needle));

  it('stamps the signed-in guard onto every decision', async () => {
    await bindSession('estate-a', 'm-guard-1');

    await enqueue({
      client_event_id: 'e1',
      code: 'AAAAAA',
      code_id: null,
      outcome: 'flagged',
      reject_reason: null,
      verified_at: '2026-09-26T10:00:00Z',
      pool_age_seconds: 12,
    });

    const insert = lastCallMatching('INSERT INTO outbox');
    expect(insert).toBeDefined();
    expect(insert!.args).toContain('m-guard-1');
  });

  // A phone that has not resolved a post yet has nobody to attribute to. The
  // row must still be recorded — an unattributed gate event beats none.
  it('still records a decision when no session is bound', async () => {
    await enqueue({
      client_event_id: 'e2',
      code: 'BBBBBB',
      code_id: null,
      outcome: 'rejected',
      reject_reason: 'unknown_code',
      verified_at: '2026-09-26T10:00:00Z',
      pool_age_seconds: null,
    });

    const insert = lastCallMatching('INSERT INTO outbox');
    expect(insert).toBeDefined();
    expect(insert!.args).toContain(null);
  });

  // The bug: guard A's queued decisions replaying during guard B's session were
  // written to the server under B's name, because the phone pushed everything
  // it had. On a shared gate phone that is the ordinary force-quit handover.
  it('scopes the push queue to the signed-in guard, keeping unstamped rows', async () => {
    await unsynced('m-guard-1');

    const q = lastCallMatching('FROM outbox');
    expect(q!.sql).toContain('membership_id IS NULL OR membership_id = ?');
    expect(q!.args[0]).toBe('m-guard-1');
  });

  it('counts only what this guard may actually push', async () => {
    await countUnsynced('m-guard-1');

    const q = lastCallMatching('count(*)');
    expect(q!.sql).toContain('membership_id IS NULL OR membership_id = ?');
    expect(q!.args[0]).toBe('m-guard-1');
  });

  // Held rows are surfaced, not hidden: nine stuck events mean "find the guard
  // who worked Tuesday night", and zero means there is nothing to chase.
  it('reports another guard\'s held rows separately', async () => {
    await countStranded('m-guard-1');

    const q = lastCallMatching('count(*)');
    // IS NOT, not !=, so an unbound session counts every stamped row rather
    // than silently matching none against NULL.
    expect(q!.sql).toContain('membership_id IS NOT NULL AND membership_id IS NOT ?');
    expect(q!.args[0]).toBe('m-guard-1');
  });
});

/**
 * The cached post is what lets a phone restarted during an outage go straight
 * back to the keypad. It is only safe if it can never open one guard's
 * session on another guard's post -- a gate phone is shared by design.
 */
describe('cached post', () => {
  const post = {
    user_id: 'u-1',
    membership_id: 'm-1',
    estate_id: 'e-1',
    estate_name: 'Acacia Park',
  };

  it('hands the post back to the guard it was resolved for', async () => {
    await rememberPost(post);

    expect(await recallPost('u-1')).toEqual(post);
  });

  it('never hands it to anybody else', async () => {
    await rememberPost(post);

    expect(await recallPost('u-2')).toBeNull();
  });

  it('is gone once forgotten', async () => {
    await rememberPost(post);
    await forgetPost();

    expect(await recallPost('u-1')).toBeNull();
    expect(await getMeta('guard_post')).toBeNull();
  });

  // A half-written row, or one from a future format, reads as nothing cached
  // -- never as a post with an undefined estate to verify against.
  it.each([
    ['not json'],
    [JSON.stringify(null)],
    [JSON.stringify({ user_id: 'u-1', membership_id: 'm-1' })],
    [JSON.stringify({ ...post, estate_id: 42 })],
  ])('treats a malformed cache (%s) as empty', async (raw) => {
    await setMeta('guard_post', raw);

    expect(await recallPost('u-1')).toBeNull();
  });
});
