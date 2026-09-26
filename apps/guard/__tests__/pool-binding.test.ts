import { bindPoolToEstate, clearPool, getMeta, setMeta, __resetDbForTests } from '@/lib/db';

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
    if (sql.depth > 0) sql.inTransaction.push(q);
    if (q.startsWith('INSERT INTO meta')) sql.meta.set(args[0] as string, args[1] as string);
    else if (q.startsWith("DELETE FROM meta WHERE key = 'cursor'")) sql.meta.delete('cursor');
  }),
  getFirstAsync: jest.fn(async (s: string, ...args: unknown[]) => {
    if (s.includes('FROM meta')) {
      const key = args[0] as string;
      return sql.meta.has(key) ? { value: sql.meta.get(key) } : null;
    }
    return null;
  }),
  getAllAsync: jest.fn(async () => []),
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

describe('bindPoolToEstate', () => {
  it('keeps the cache when the estate is unchanged', async () => {
    await bindPoolToEstate('estate-a');
    sql.statements = [];
    await setMeta('cursor', '99');

    const wiped = await bindPoolToEstate('estate-a');

    expect(wiped).toBe(false);
    expect(await getMeta('cursor')).toBe('99');
    expect(sql.statements).not.toContain('DELETE FROM pool');
  });

  // The one that matters. A gate phone that was force-quit rather than signed
  // out still holds the previous estate's codes, and findInPool matches on the
  // typed code alone — there is no estate_id on a pool row to save us.
  it('wipes a cache that was filled for a different estate', async () => {
    await bindPoolToEstate('estate-a');
    await setMeta('cursor', '99');
    sql.statements = [];

    const wiped = await bindPoolToEstate('estate-b');

    expect(wiped).toBe(true);
    expect(sql.statements).toContain('DELETE FROM pool');
    expect(await getMeta('cursor')).toBeNull();
    expect(await getMeta('pool_estate_id')).toBe('estate-b');
  });

  // A fresh install has no pool to protect, and wiping would be a pointless
  // extra transaction on the slowest path the app has (first launch).
  it('does not wipe on a first bind', async () => {
    const wiped = await bindPoolToEstate('estate-a');

    expect(wiped).toBe(false);
    expect(sql.statements).not.toContain('DELETE FROM pool');
    expect(await getMeta('pool_estate_id')).toBe('estate-a');
  });
});
