import {
  displayStatus,
  type DisplayStatus,
  type DuesBillingMode,
  type DuesChargeStatus,
  type MintResult,
} from '@estate/core';

import { supabase } from './supabase';

export interface CodeRow {
  id: string;
  code: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_reason: string | null;
  status: DisplayStatus;
  is_delivery: boolean;
  /** Instructions for a rider. Only ever populated when `is_delivery`. */
  delivery_note: string | null;
}

/** What the resident answered in the delivery prompt before the code was minted. */
export interface DeliveryDetails {
  isDelivery: boolean;
  /** Trimmed by the server; whitespace-only is stored as no note at all. */
  note?: string | null;
}

/**
 * Mint a 6-hour code.
 *
 * The cap and the rate limit are enforced inside the function transactionally
 * (Technical Design §3.1) — a rejection comes back as a `result` value, NOT a
 * thrown error, so branch on it rather than treating it as a failure. The
 * `error` channel is for genuine faults: network, auth, or a bug.
 */
export async function mintCode(
  estateId: string,
  delivery: DeliveryDetails = { isDelivery: false },
): Promise<MintResult> {
  const { data, error } = await supabase.rpc('mint_access_code', {
    p_estate_id: estateId,
    p_is_delivery: delivery.isDelivery,
    // Omitted rather than sent empty. PostgREST leaves out an undefined
    // argument, so the function's own `default null` applies — and the CHECK
    // constraint rejects a zero-length note, so '' was never valid anyway.
    p_delivery_note: delivery.isDelivery ? delivery.note?.trim() || undefined : undefined,
  });

  if (error) throw new Error(error.message);

  // The function RETURNS TABLE, so PostgREST gives us an array of one row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('mint_access_code returned no row');

  return row as MintResult;
}

/**
 * The resident's own codes.
 *
 * Note the absent `.eq('membership_id', …)`: the RLS policy on `access_codes`
 * already restricts rows to the caller's own. Adding the filter would be
 * harmless but relying on it would be the mistake — RLS is what makes a
 * forgotten filter survivable (§6.2).
 */
export async function listMyCodes(): Promise<CodeRow[]> {
  const { data, error } = await supabase
    .from('access_codes')
    .select(
      'id, code, created_at, expires_at, used_at, revoked_reason, status, is_delivery, delivery_note',
    )
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  // Status is DERIVED, never read straight off the column: a stored 'active'
  // row past its expires_at is expired (§2.4).
  return (data ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    created_at: r.created_at,
    expires_at: r.expires_at,
    used_at: r.used_at,
    revoked_reason: r.revoked_reason,
    status: displayStatus({ status: r.status, expires_at: r.expires_at }),
    is_delivery: r.is_delivery ?? false,
    delivery_note: r.delivery_note ?? null,
  }));
}

export type JoinResult =
  | { result: 'ok'; estate_id: string; estate_name: string; house_id: string; house_number: string }
  | { result: 'already_a_member'; estate_id: string; estate_name: string; house_id: string | null; house_number: string | null }
  | { result: 'already_pending'; estate_id: string; estate_name: string; house_id: string | null; house_number: string | null }
  | { result: 'unknown_estate'; estate_id: null; estate_name: null; house_id: null; house_number: null }
  | { result: 'unknown_house'; estate_id: string; estate_name: string; house_id: null; house_number: null }
  | { result: 'rate_limited'; estate_id: null; estate_name: null; house_id: null; house_number: null };

/**
 * Ask to join a HOUSE at an estate.
 *
 * Two codes, because a house code is only unique within its estate — the pair
 * is what resolves. `unknown_estate` and `unknown_house` are deliberately
 * separate results: "your estate code is wrong" and "your house code is wrong"
 * are different conversations at the front desk.
 *
 * Like mint_access_code, rejections come back as a `result` VALUE rather than a
 * thrown error, because raising would roll back the rate-limit counter.
 */
export async function requestHouseAccess(
  estateCode: string,
  houseCode: string,
): Promise<JoinResult> {
  const { data, error } = await supabase.rpc('request_house_access', {
    p_estate_code: estateCode,
    p_house_code: houseCode,
  });
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('request_house_access returned no row');
  return row as JoinResult;
}

export interface PendingJoinRequest {
  estate_id: string;
  estate_name: string;
  house_number: string | null;
  created_at: string;
}

/**
 * The requests this user is waiting on, newest first.
 *
 * Server-read rather than remembered on the device: the codes are typed at
 * sign-up, so by the time the join screen appears the request is usually
 * already in. Local state would be empty after a restart and would show a
 * waiting resident an empty form, which reads as "nothing was sent".
 */
export async function myPendingJoinRequests(): Promise<PendingJoinRequest[]> {
  const { data, error } = await supabase.rpc('my_pending_join_requests');
  if (error) throw new Error(error.message);
  return (data ?? []) as PendingJoinRequest[];
}

/** Register this device for "your code was used" notifications (§6.1). */
export async function registerPushToken(
  estateId: string,
  token: string,
  deviceId?: string,
): Promise<void> {
  const { error } = await supabase.rpc('register_push_token', {
    p_estate_id: estateId,
    p_role: 'resident',
    p_token: token,
    // The SQL param defaults to null; the generated type models that as
    // optional, so pass undefined rather than an explicit null.
    p_device_id: deviceId,
  });
  if (error) throw new Error(error.message);
}

// ─── Estate dues ─────────────────────────────────────────────────────────────

export interface DuesCharge {
  charge_id: string;
  period: string;
  amount_minor: number;
  currency: string;
  due_on: string;
  status: DuesChargeStatus;
  is_overdue: boolean;
  billing_mode: DuesBillingMode;
  /** 'house' when the whole house is billed, 'resident' when each person is. */
  subject: string;
  /**
   * Shareable link token for this charge.
   *
   * Returned to the resident as well as emailed to a landlord, deliberately. In
   * a house-billed estate a tenant often settles and squares up privately, and
   * routing them through the landlord would serve nobody.
   */
  pay_token: string;
  /**
   * Who to chase when the landlord is the one billed.
   *
   * Null in a per_resident estate, and null for a house whose landlord was
   * never recorded -- the screen branches on billing_mode, not on these being
   * present, so a missing landlord falls back to the estate office rather than
   * rendering blanks.
   */
  landlord_name: string | null;
  landlord_phone: string | null;
  landlord_email: string | null;
  /**
   * Whether this estate has authorised withholding code generation for arrears.
   *
   * Not "am I blocked" -- that is this AND is_overdue. Kept separate because
   * the two states need different words: an estate can bill dues and restrict
   * nobody, and telling that resident "codes are paused" is a lie their next
   * tap disproves.
   */
  enforcement_on: boolean;
}

/**
 * The numbers the Dues tab opens with.
 *
 * Separate from listMyDues because of one case that list cannot serve: an
 * estate with dues configured but no charges raised yet returns ZERO ROWS, and
 * a screen built only from that list would tell a resident who owes money from
 * the 1st that there is nothing here. The summary always returns one row.
 *
 * The arithmetic stays server-side. When the next charge falls due depends on
 * the estate's grace period and on when charges are raised, and a client
 * reimplementing that is a client that disagrees with the gate the first time
 * either changes.
 */
export interface DuesSummary {
  billing_mode: DuesBillingMode;
  /** The estate's monthly rate. Null when it does not bill through the app. */
  monthly_minor: number | null;
  currency: string | null;
  grace_days: number;
  enforcement_on: boolean;
  outstanding_minor: number;
  outstanding_count: number;
  overdue_minor: number;
  overdue_count: number;
  paid_count: number;
  /** Overdue AND enforced. One definition, shared by the banner, tab and gate. */
  blocked: boolean;
  /** The next month not yet billed, and when it falls due. Null if not billing. */
  next_period: string | null;
  next_due_on: string | null;
}

export async function myDuesSummary(estateId: string): Promise<DuesSummary | null> {
  const { data, error } = await supabase.rpc('my_dues_summary', { p_estate_id: estateId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as DuesSummary | null;
}

export async function listMyDues(estateId: string): Promise<DuesCharge[]> {
  const { data, error } = await supabase.rpc('my_dues', { p_estate_id: estateId });
  if (error) throw new Error(error.message);
  return (data ?? []) as DuesCharge[];
}

/**
 * Start a payment and get the hosted checkout link.
 *
 * Goes through an Edge Function, not straight to Flutterwave: the secret key
 * can do anything on the account and must never be in a phone bundle. The
 * amount is never sent from here either -- it is read from the charge row
 * inside the database, which is what stops a client choosing its own price.
 */
export async function startDuesPayment(chargeId: string, months = 1): Promise<string> {
  // `months` is how far ahead to pay (1, 3, 6 or 12), never a price: the total
  // is computed in the database from the months it decides to cover.
  const { data, error } = await supabase.functions.invoke('dues-checkout', {
    body: { charge_id: chargeId, months },
  });
  if (error) throw new Error(error.message);
  if (!data?.link) throw new Error(data?.error ?? 'Could not start the payment');
  return data.link as string;
}
