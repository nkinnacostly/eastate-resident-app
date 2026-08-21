/**
 * Shared domain constants and RPC contract types.
 *
 * There is no API layer in this system (Technical Design §8) — the RPC
 * signatures and these types ARE the contract. Anything here that also exists
 * in SQL is duplicated on purpose and must be changed in both places; the
 * migration is the source of truth, this file mirrors it for the clients.
 */

// ─── Codes (Technical Design §3) ──────────────────────────────────────────────

/** Ambiguous glyphs excluded: no 0/O, no 1/I/L. Mirrors public.generate_code(). */
export const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const CODE_TTL_HOURS = 6;

/** Locked at 3 (§3.1). Enforced transactionally in mint_access_code(). */
export const MAX_ACTIVE_CODES_PER_RESIDENT = 3;

/** Mirrors v_limit in mint_access_code() (§3.2). */
export const MINT_RATE_LIMIT_PER_MINUTE = 10;

/**
 * Cap on a delivery code's instructions.
 *
 * Enforced in mint_access_code() AND by a CHECK constraint, because the note is
 * free text a resident types and it ends up inside a forwarded message. The
 * client caps input at the same number so the server limit is a backstop rather
 * than something a resident ever meets.
 */
export const MAX_DELIVERY_NOTE_LENGTH = 200;

// ─── Offline sync (Technical Design §5.2) ─────────────────────────────────────

/** Past this, the guard's verify screen shows the degraded-mode banner. */
export const POOL_STALE_THRESHOLD_SECONDS = 15 * 60;

/** How often the guard app pulls codes / pushes queued events while active. */
export const SYNC_INTERVAL_SECONDS = 45;

/** Cap on the guard's local reject queue so a faulty device can't flood the log (§2.5). */
export const MAX_QUEUED_REJECTIONS = 200;

// ─── Enums — must match the Postgres types exactly ────────────────────────────

export type MembershipRole = 'resident' | 'guard' | 'admin';
export type CodeStatus = 'active' | 'used' | 'revoked';
export type RevokedReason =
  | 'membership_deactivated'
  | 'admin_revoked'
  | 'resident_cancelled';
export type EventSource = 'online' | 'offline_replay';
export type EventOutcome = 'pending' | 'admitted' | 'collision' | 'rejected';
export type RejectReason = 'unknown_code' | 'expired' | 'already_used' | 'revoked';

/**
 * What a resident sees. Derived, never read straight off `status` — a stored
 * `active` row past its `expires_at` is expired (§2.4).
 */
export type DisplayStatus = 'live' | 'used' | 'expired' | 'revoked';

// ─── RPC results ──────────────────────────────────────────────────────────────

/** Return of rpc('mint_access_code'). Note these are results, not errors: the
 *  function deliberately does not RAISE for expected outcomes (§3.1). */
export type MintResult =
  | { result: 'ok'; code: string; expires_at: string }
  | { result: 'code_limit_reached'; code: null; expires_at: null }
  | { result: 'rate_limited'; code: null; expires_at: null }
  | { result: 'code_collision'; code: null; expires_at: null }
  | { result: 'not_a_resident'; code: null; expires_at: null }
  | { result: 'note_too_long'; code: null; expires_at: null };

/** One queued offline verification, pushed via rpc('ingest_verification_events'). */
export interface PendingVerification {
  client_event_id: string;
  /** Null when the typed code didn't resolve against the local pool. */
  code_id: string | null;
  /** The raw string the guard typed. Kept so unknown codes are still auditable. */
  code: string;
  /** Device clock. Displayed to humans; never used for ordering (§10). */
  verified_at: string;
  pool_age_seconds: number | null;
}

/** Return of rpc('sync_pull'). */
export interface SyncPullResult {
  upserts: { id: string; code: string; expires_at: string }[];
  /** Ids to delete locally — used or revoked. Expiry never arrives here (§5.2). */
  tombstones: string[];
  cursor: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function displayStatus(row: {
  status: CodeStatus;
  expires_at: string;
}): DisplayStatus {
  if (row.status === 'used') return 'used';
  if (row.status === 'revoked') return 'revoked';
  return new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : 'live';
}

/** Only live codes consume cap slots (§6.2). */
export function countsAgainstCap(row: {
  status: CodeStatus;
  expires_at: string;
}): boolean {
  return displayStatus(row) === 'live';
}
