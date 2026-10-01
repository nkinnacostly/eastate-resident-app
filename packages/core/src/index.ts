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

/**
 * How long a guard's phone may keep verifying without the server confirming it
 * is still their post.
 *
 * DERIVED from the code lifetime, and that is the whole argument for it. A
 * successful sync_pull proves two things at once: the pool is current, and the
 * server still accepts this caller as an active guard at this estate -- the RPC
 * raises not_a_guard_at_this_estate otherwise. So the time since the last
 * successful pull is equally a measure of how stale the authorisation is.
 *
 * Every code the pool holds was minted at or before that pull, and a code lives
 * CODE_TTL_HOURS from minting. So once this much time has passed with no
 * contact, the pool cannot contain a single admissible code -- it is already
 * worthless. Stopping there costs nothing that was not already gone, which is
 * why this does NOT contradict the locked decision that a stale pool still
 * admits. That rule is about codes, and it stands: a pool minutes or hours old
 * keeps working through an outage, exactly as designed. This is about the
 * GUARD, and it closes the one case that rule never covered -- a guard
 * dismissed mid-shift whose phone would otherwise go on opening the gate.
 *
 * Bound to CODE_TTL_HOURS rather than written as 6 so the two can never drift:
 * lengthen a code's life and the window follows it, keeping the cost at zero.
 */
export const OFFLINE_AUTHORISATION_TTL_SECONDS = CODE_TTL_HOURS * 3600;

/** How often the guard app pulls codes / pushes queued events while active. */
export const SYNC_INTERVAL_SECONDS = 45;

/** Cap on the guard's local reject queue so a faulty device can't flood the log (§2.5). */
export const MAX_QUEUED_REJECTIONS = 200;

// ─── Estate dues ──────────────────────────────────────────────────────────────

export type DuesBillingMode = 'none' | 'per_house' | 'per_resident';
export type DuesChargeStatus = 'open' | 'paid' | 'waived';

/**
 * How far ahead a payer can settle in one checkout. Dues stay MONTHLY -- a term
 * pays several monthly charges at once; it does not change how the estate
 * bills. Must match the CHECK on dues_payments.months and parseTerm in the
 * Edge Functions. No discount for longer terms (a product decision).
 */
export const DUES_TERMS = [
  { months: 1, label: 'Monthly' },
  { months: 3, label: 'Quarterly' },
  { months: 6, label: 'Half-yearly' },
  { months: 12, label: 'Yearly' },
] as const;
export type DuesTermMonths = (typeof DUES_TERMS)[number]['months'];

/**
 * What a term will cost, FOR DISPLAY on the button before checkout.
 *
 * The database prices the real checkout from the plan it freezes; this mirrors
 * that plan closely enough to label a button: the open charges oldest first at
 * their own amounts, then months not billed yet at the current monthly rate.
 * Null when it cannot be estimated -- better no figure than a wrong one.
 */
export function estimateTermTotal(
  openAmountsOldestFirst: number[],
  monthlyMinor: number | null,
  months: number,
): number | null {
  const billed = openAmountsOldestFirst.slice(0, months);
  const unbilled = months - billed.length;
  if (unbilled > 0 && !monthlyMinor) return null;
  return billed.reduce((n, a) => n + a, 0) + unbilled * (monthlyMinor ?? 0);
}

/**
 * Format an amount held in minor units.
 *
 * Money is stored as an integer number of kobo/cents everywhere and divided
 * only for display. Never the other way round: 0.1 + 0.2 is not 0.3 in binary
 * floating point, and dues that do not add up are dues an estate will not
 * trust.
 */
export function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat(currency === 'ZAR' ? 'en-ZA' : 'en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    }).format(major);
  } catch {
    // An unknown currency code must not take a payment screen down.
    return `${currency} ${major.toLocaleString()}`;
  }
}

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
  | { result: 'note_too_long'; code: null; expires_at: null }
  /**
   * Estate dues are overdue.
   *
   * Only ever blocks MINTING. A code already issued still verifies at the gate,
   * the resident's own access is untouched, and the guard's admit-and-flag
   * override still works -- which is both the architectural line (a verify path
   * that had to read a balance could not verify offline) and the legal one.
   */
  | { result: 'dues_unpaid'; code: null; expires_at: null };

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
