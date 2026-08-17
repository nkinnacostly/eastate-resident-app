import { displayStatus, type DisplayStatus, type MintResult } from '@estate/core';

import { supabase } from './supabase';

export interface CodeRow {
  id: string;
  code: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_reason: string | null;
  status: DisplayStatus;
}

/**
 * Mint a 6-hour code.
 *
 * The cap and the rate limit are enforced inside the function transactionally
 * (Technical Design §3.1) — a rejection comes back as a `result` value, NOT a
 * thrown error, so branch on it rather than treating it as a failure. The
 * `error` channel is for genuine faults: network, auth, or a bug.
 */
export async function mintCode(estateId: string): Promise<MintResult> {
  const { data, error } = await supabase.rpc('mint_access_code', {
    p_estate_id: estateId,
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
    .select('id, code, created_at, expires_at, used_at, revoked_reason, status')
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
