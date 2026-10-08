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
  /**
   * Which guard made this call, captured when the decision was made.
   *
   * LOCAL ONLY -- it is never sent to the server, because a client-supplied
   * membership id is a forged identity and the ingest RPC rightly derives the
   * actor from auth.uid(). Its job here is the opposite: to stop this phone
   * pushing one guard's decisions under another guard's session. See unsynced().
   *
   * Null on rows enqueued before this column existed.
   */
  membership_id: string | null;
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
        membership_id    TEXT,
        synced           INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS outbox_unsynced_idx ON outbox (synced, verified_at);

      -- Single-row bag for the sync cursor and last-pull time.
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );
    `);

    // Phones already in the field have an outbox without membership_id, and
    // CREATE TABLE IF NOT EXISTS will not add it to them. Ask the table what
    // it has rather than tracking a version number: on a fresh install the
    // CREATE above already included the column, so this is a no-op, and on an
    // upgrade it is exactly the one ALTER needed. Getting this wrong either
    // way throws -- "duplicate column name" on fresh, "no such column" on
    // upgrade -- so it cannot fail silently.
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(outbox)');
    if (columns.length > 0 && !columns.some((c) => c.name === 'membership_id')) {
      await db.execAsync('ALTER TABLE outbox ADD COLUMN membership_id TEXT');
    }

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

// ─── post ────────────────────────────────────────────────────────────────────

/**
 * The last post the SERVER confirmed for a guard, kept so a restart during an
 * outage does not end the shift.
 *
 * The post (which estate, which membership) is resolved by a network query,
 * and without this a phone restarted with no signal came up with no post, was
 * routed to sign-in, and could not verify anything -- the offline pool sat on
 * disk, full, unreachable. A crash, a flat battery or an OS kill during an
 * outage is exactly when that pool exists to be used.
 *
 * Kept under the user it was resolved for and only ever handed back to that
 * user: a shared gate phone must not start one guard's session on another
 * guard's post. Forgotten whenever the server says there is no post, or the
 * session ends -- see shift.tsx.
 */
export interface CachedPost {
  user_id: string;
  membership_id: string;
  estate_id: string;
  estate_name: string;
}

const POST_KEY = 'guard_post';

export async function rememberPost(post: CachedPost): Promise<void> {
  await setMeta(POST_KEY, JSON.stringify(post));
}

/** The cached post for THIS user, or null -- never somebody else's. */
export async function recallPost(userId: string): Promise<CachedPost | null> {
  const raw = await getMeta(POST_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<CachedPost> | null;
    // Shape-checked rather than cast: a half-written or older-format row must
    // read as "nothing cached", not as a post with an undefined estate.
    if (
      !p ||
      p.user_id !== userId ||
      typeof p.membership_id !== 'string' ||
      typeof p.estate_id !== 'string' ||
      typeof p.estate_name !== 'string'
    ) {
      return null;
    }
    return {
      user_id: p.user_id,
      membership_id: p.membership_id,
      estate_id: p.estate_id,
      estate_name: p.estate_name,
    };
  } catch {
    return null;
  }
}

export async function forgetPost(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM meta WHERE key = ?', POST_KEY);
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
  row: Omit<OutboxRow, 'synced' | 'membership_id'>,
  synced: 0 | 1 = 0,
): Promise<void> {
  const db = await getDb();
  // Read here rather than threaded through verifyOnline/verifyOffline/
  // admitAndFlag: the answer is a property of the session, not of the call,
  // and the three call sites would only be passing along what bindSession
  // already recorded. poolAgeSeconds() reads meta the same way.
  const membershipId = await getMeta('session_membership_id');
  // DO NOTHING, not DO UPDATE: a client_event_id is claimed once. A retry with
  // the same id must not rewrite the outcome a guard already committed to.
  await db.runAsync(
    `INSERT INTO outbox
       (client_event_id, code, code_id, outcome, reject_reason, verified_at, pool_age_seconds, membership_id, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_event_id) DO NOTHING`,
    row.client_event_id,
    row.code,
    row.code_id,
    row.outcome,
    row.reject_reason,
    row.verified_at,
    row.pool_age_seconds,
    membershipId,
    synced,
  );
}

/**
 * Rows the CURRENT guard may push.
 *
 * The filter is the whole point. ingest_verification_events derives the actor
 * from auth.uid() -- correctly, since a client-supplied membership id would be
 * a forged identity -- which means whoever is signed in at push time is the
 * person the server records. Replaying guard A's queued decisions during guard
 * B's session therefore writes B's name onto A's calls, and the audit trail
 * says the wrong officer admitted the visitor. On a shared gate phone that is
 * not a corner case: it is what happens after a force-quit handover.
 *
 * So a row that belongs to someone else is held, not pushed. It is a debt this
 * session cannot honestly settle, and it clears the moment that guard signs in
 * again on this phone -- which, at a fixed gate, is usually their next shift.
 *
 * Rows with a NULL membership_id predate the stamp. They push under whoever is
 * present, exactly as they always did: imperfect attribution on old rows beats
 * stranding audit records that can never be recovered from anywhere else.
 */
export async function unsynced(membershipId: string | null, limit = 100): Promise<OutboxRow[]> {
  const db = await getDb();
  return db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox
      WHERE synced = 0 AND (membership_id IS NULL OR membership_id = ?)
      ORDER BY verified_at ASC LIMIT ?`,
    membershipId,
    limit,
  );
}

export async function countUnsynced(membershipId: string | null): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT count(*) AS n FROM outbox
      WHERE synced = 0 AND (membership_id IS NULL OR membership_id = ?)`,
    membershipId,
  );
  return row?.n ?? 0;
}

/**
 * Queued decisions belonging to a DIFFERENT guard.
 *
 * Surfaced rather than hidden: these are real gate events the server has not
 * seen, and a count of zero versus a count of nine is the difference between
 * "nothing to do" and "go and find the guard who worked Tuesday night".
 */
export async function countStranded(membershipId: string | null): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT count(*) AS n FROM outbox
      WHERE synced = 0 AND membership_id IS NOT NULL AND membership_id IS NOT ?`,
    membershipId,
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

/**
 * Ending a shift clears the cache but never the ledger.
 *
 * The CURSOR goes with the rows, in one transaction, and that pairing is the
 * whole point of this function. They are two halves of one cache: the rows,
 * and the position those rows were fetched to. Deleting the rows alone left
 * the phone claiming "I already hold everything up to sync_seq N" while
 * holding nothing — and sync_pull returns only `sync_seq > cursor`, so the
 * pool refilled with codes minted AFTER the handover and nothing before it.
 *
 * That is silent, and it fails exactly where offline mode is meant to earn its
 * keep: a code a resident minted twenty minutes before the shift change is
 * still valid for another five and a half hours, and the incoming guard's
 * phone would never receive it. Online, nobody notices — the server resolves
 * the code directly. Offline, that visitor is refused as an unknown code.
 */
export async function clearPool(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM pool');
    await db.runAsync("DELETE FROM meta WHERE key = 'cursor'");
  });
}

/**
 * Bind the cache to one estate, discarding it if it was filled for another.
 *
 * The invariant: **the pool belongs to exactly one estate, and the app must
 * prove it before reading from it.** Sign-out already clears the pool, but
 * sign-out is the polite path. A gate phone on a shared charger dies, is
 * force-quit, or is handed over mid-shift, and none of those run it — so the
 * next guard can sign in at a DIFFERENT estate on top of a live pool holding
 * the previous estate's codes. `findInPool` matches on the typed code alone
 * (there is no estate_id on the row to match against), so one of those codes
 * would be admitted at a gate it was never minted for.
 *
 * Checked at post resolution rather than at pull time on purpose: a pull needs
 * the network, and the dangerous case is precisely the one where the phone is
 * verifying from cache.
 *
 * Also records WHO is on shift, which enqueue() stamps onto every decision.
 * Both facts arrive at the same moment and neither is safe to assume, so they
 * are set together.
 */
export async function bindSession(estateId: string, membershipId: string): Promise<boolean> {
  await setMeta('session_membership_id', membershipId);
  const previous = await getMeta('pool_estate_id');
  if (previous === estateId) return false;
  if (previous !== null) await clearPool();
  await setMeta('pool_estate_id', estateId);
  return previous !== null;
}
