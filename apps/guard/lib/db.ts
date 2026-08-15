import * as SQLite from 'expo-sqlite';

/**
 * The guard's local store: a pool of codes it may admit, and an outbox of
 * verifications it still owes the server.
 *
 * Two tables, two very different jobs:
 *
 *   `pool`    is a CACHE. It is disposable — wiped and refilled from sync_pull,
 *             and losing it costs only a round trip.
 *   `outbox`  is a LEDGER. Every row is a decision a guard already made at a
 *             gate; the server has not seen it yet. Losing a row loses an
 *             audit record that cannot be reconstructed, so nothing deletes
 *             from it until the server has acknowledged that exact
 *             client_event_id.
 *
 * API verified against the Expo SDK 54 docs (openDatabaseAsync / execAsync /
 * runAsync / getAllAsync / withTransactionAsync).
 */

export interface PoolCode {
  id: string;
  code: string;
  expires_at: string;
}

export type OutboxOutcome = 'admitted' | 'rejected' | 'flagged';

export interface OutboxRow {
  client_event_id: string;
  code: string;
  code_id: string | null;
  outcome: OutboxOutcome;
  reject_reason: string | null;
  /** Device clock. Shown to humans, never used for ordering (§10). */
  verified_at: string;
  pool_age_seconds: number | null;
  synced: 0 | 1;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync('guard.db');
    // WAL: the sync loop writes while the keypad reads. Without it a pull
    // mid-verification blocks the read and the gate stutters.
    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS pool (
        id          TEXT PRIMARY KEY NOT NULL,
        code        TEXT NOT NULL,
        expires_at  TEXT NOT NULL
      );
      -- Lookup is by typed code, not by id.
      CREATE INDEX IF NOT EXISTS pool_code_idx ON pool (code);

      CREATE TABLE IF NOT EXISTS outbox (
        client_event_id  TEXT PRIMARY KEY NOT NULL,
        code             TEXT NOT NULL,
        code_id          TEXT,
        outcome          TEXT NOT NULL,
        reject_reason    TEXT,
        verified_at      TEXT NOT NULL,
        pool_age_seconds INTEGER,
        synced           INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS outbox_unsynced_idx ON outbox (synced, verified_at);

      -- Single-row bag for the sync cursor and last-pull time.
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );
    `);
    return db;
  })();
  return dbPromise;
}

/** Test seam — lets a suite start from a known-empty database. */
export function __resetDbForTests() {
  dbPromise = null;
}

// ─── meta ────────────────────────────────────────────────────────────────────

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM meta WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

// ─── pool ────────────────────────────────────────────────────────────────────

/**
 * Apply one sync_pull payload.
 *
 * Upserts and tombstones are applied in ONE transaction: a half-applied pull
 * would leave the cursor claiming rows the pool doesn't hold, and the next pull
 * starts after them — the gap never heals.
 */
export async function applyPull(
  upserts: PoolCode[],
  tombstones: string[],
  cursor: number,
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const c of upserts) {
      await db.runAsync(
        `INSERT INTO pool (id, code, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at`,
        c.id,
        c.code,
        c.expires_at,
      );
    }
    for (const id of tombstones) {
      await db.runAsync('DELETE FROM pool WHERE id = ?', id);
    }
    await db.runAsync(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'cursor',
      String(cursor),
    );
  });
}

/**
 * Find a typed code in the pool.
 *
 * Expiry is DERIVED here exactly as it is on the server — a pool row past its
 * expires_at is expired, and the guard app must reach that verdict on its own
 * because offline it has no one to ask (§2.4).
 */
export async function findInPool(code: string, now = Date.now()): Promise<PoolCode | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<PoolCode>('SELECT * FROM pool WHERE code = ?', code);
  if (!row) return null;
  return new Date(row.expires_at).getTime() > now ? row : null;
}

/** Raw lookup, ignoring expiry — so a verdict can say "expired" not "unknown". */
export async function findInPoolIgnoringExpiry(code: string): Promise<PoolCode | null> {
  const db = await getDb();
  return (await db.getFirstAsync<PoolCode>('SELECT * FROM pool WHERE code = ?', code)) ?? null;
}

/** How many codes this phone could still admit — the "28 codes live" counter. */
export async function countLivePool(now = Date.now()): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT count(*) AS n FROM pool WHERE expires_at > ?',
    new Date(now).toISOString(),
  );
  return row?.n ?? 0;
}

/**
 * Burn a code locally so the SAME phone cannot admit it twice while offline.
 *
 * This is not the authoritative burn — that only happens server-side, inside
 * ingest_verification_events. Removing it from the pool is what stops a visitor
 * walking back to the same gate and reusing the code during an outage.
 */
export async function burnLocally(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM pool WHERE id = ?', id);
}

// ─── outbox ──────────────────────────────────────────────────────────────────

/**
 * Record a decision in the ledger.
 *
 * `synced` is 1 for verifications the SERVER already committed (the online
 * path): the row exists so the shift log can show it, but replaying it would
 * push an event the server has already recorded. It is a log entry, not a debt.
 */
export async function enqueue(
  row: Omit<OutboxRow, 'synced'>,
  synced: 0 | 1 = 0,
): Promise<void> {
  const db = await getDb();
  // DO NOTHING, not DO UPDATE: a client_event_id is claimed once. A retry with
  // the same id must not rewrite the outcome a guard already committed to.
  await db.runAsync(
    `INSERT INTO outbox
       (client_event_id, code, code_id, outcome, reject_reason, verified_at, pool_age_seconds, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_event_id) DO NOTHING`,
    row.client_event_id,
    row.code,
    row.code_id,
    row.outcome,
    row.reject_reason,
    row.verified_at,
    row.pool_age_seconds,
    synced,
  );
}

export async function unsynced(limit = 100): Promise<OutboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>(
    'SELECT * FROM outbox WHERE synced = 0 ORDER BY verified_at ASC LIMIT ?',
    limit,
  );
}

export async function countUnsynced(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT count(*) AS n FROM outbox WHERE synced = 0',
  );
  return row?.n ?? 0;
}

/** Mark acknowledged. Rows are KEPT — the shift log reads them back. */
export async function markSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const holes = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE outbox SET synced = 1 WHERE client_event_id IN (${holes})`, ...ids);
}

/** The shift log: newest first, by DEVICE time — it is all this phone knows. */
export async function recentEvents(limit = 50): Promise<OutboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>(
    'SELECT * FROM outbox ORDER BY verified_at DESC LIMIT ?',
    limit,
  );
}

/** Ending a shift clears the cache but never the ledger. */
export async function clearPool(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM pool');
}
