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
