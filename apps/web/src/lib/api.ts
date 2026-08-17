import { countsAgainstCap, displayStatus, type DisplayStatus } from '@estate/core';

import { supabase } from './supabase';

/**
 * Every query here filters on estate_id even though RLS already scopes rows to
 * estates the caller administers. The filter is not the security boundary — RLS
 * is — but an admin at two estates would otherwise see both sets merged into
 * one table with no way to tell them apart.
 */

export interface PersonRow {
  membership_id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  unit: string | null;
  is_active: boolean;
  live_codes: number;
}

export interface PendingRow {
  id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  requested_unit: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  code: string | null;
  outcome: string;
  reject_reason: string | null;
  verified_at: string;
  synced_at: string | null;
  source: string;
  guard_name: string;
  host_name: string | null;
  host_unit: string | null;
}

export interface CodeRow {
  id: string;
  code: string;
  created_at: string;
  expires_at: string;
  status: DisplayStatus;
  owner_name: string;
  owner_unit: string | null;
}

// ─── people ──────────────────────────────────────────────────────────────────

export async function listPeople(
  estateId: string,
  role: 'resident' | 'guard',
): Promise<PersonRow[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('id, user_id, is_active, houses(house_number, house_code), profiles(full_name, phone)')
    .eq('estate_id', estateId)
    .eq('role', role)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((m) => {
    const p = m.profiles as { full_name: string | null; phone: string | null } | null;
    return {
      membership_id: m.id,
      user_id: m.user_id,
      full_name: p?.full_name ?? 'Unnamed',
      phone: p?.phone ?? null,
      unit: (m.houses as { house_number: string } | null)?.house_number ?? null,
      is_active: m.is_active,
      live_codes: 0,
    };
  });

  if (role !== 'resident' || rows.length === 0) return rows;

  // Cap usage is DERIVED from the codes, not stored: a row still marked
  // 'active' past its expires_at does not occupy a slot (§2.4).
  const { data: codes, error: codeErr } = await supabase
    .from('access_codes')
    .select('membership_id, status, expires_at')
    .eq('estate_id', estateId);
  if (codeErr) throw new Error(codeErr.message);

  const live = new Map<string, number>();
  for (const c of codes ?? []) {
    if (countsAgainstCap({ status: c.status, expires_at: c.expires_at })) {
      live.set(c.membership_id, (live.get(c.membership_id) ?? 0) + 1);
    }
  }
  return rows.map((r) => ({ ...r, live_codes: live.get(r.membership_id) ?? 0 }));
}

export async function listPending(estateId: string): Promise<PendingRow[]> {
  const { data, error } = await supabase
    .from('join_requests')
    .select('id, user_id, requested_unit, created_at, houses(house_number, house_code), profiles:user_id(full_name, phone)')
    .eq('estate_id', estateId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => {
    const p = r.profiles as { full_name: string | null; phone: string | null } | null;
    return {
      id: r.id,
      user_id: r.user_id,
      full_name: p?.full_name ?? 'Unnamed',
      phone: p?.phone ?? null,
      requested_unit: (r.houses as { house_number: string } | null)?.house_number ?? r.requested_unit,
      created_at: r.created_at,
    };
  });
}

export async function approveRequest(requestId: string): Promise<void> {
  // No unit parameter: the house came from the code the resident typed, so the
  // admin is confirming a person, not retyping an address.
  const { error } = await supabase.rpc('approve_join_request', { p_request_id: requestId });
  if (error) throw new Error(error.message);
}

export async function declineRequest(requestId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('decline_join_request', {
    p_request_id: requestId,
    p_reason: reason || undefined,
  });
  if (error) throw new Error(error.message);
}

export async function deactivateMembership(membershipId: string): Promise<void> {
  const { error } = await supabase.rpc('deactivate_membership', {
    p_membership_id: membershipId,
  });
  if (error) throw new Error(error.message);
}

export interface HouseRow {
  id: string;
  house_code: string;
  house_number: string;
  landlord_name: string | null;
  landlord_phone: string | null;
  is_active: boolean;
  residents: number;
}

export async function listHouses(estateId: string): Promise<HouseRow[]> {
  const { data, error } = await supabase
    .from('houses')
    .select('id, house_code, house_number, landlord_name, landlord_phone, is_active')
    .eq('estate_id', estateId)
    .order('house_number', { ascending: true });
  if (error) throw new Error(error.message);

  // Resident counts come from memberships rather than a stored tally, so a
  // suspended or moved-out resident drops out without anything to keep in sync.
  const { data: mem, error: mErr } = await supabase
    .from('memberships')
    .select('house_id, is_active')
    .eq('estate_id', estateId)
    .eq('role', 'resident');
  if (mErr) throw new Error(mErr.message);

  const counts = new Map<string, number>();
  for (const m of mem ?? []) {
    if (m.is_active && m.house_id) counts.set(m.house_id, (counts.get(m.house_id) ?? 0) + 1);
  }
  return (data ?? []).map((h) => ({ ...h, residents: counts.get(h.id) ?? 0 }));
}

export async function createHouse(
  estateId: string,
  houseNumber: string,
  landlordName: string,
  landlordPhone: string,
): Promise<{ house_code: string; house_number: string }> {
  const { data, error } = await supabase.rpc('create_house', {
    p_estate_id: estateId,
    p_house_number: houseNumber,
    p_landlord_name: landlordName || undefined,
    p_landlord_phone: landlordPhone || undefined,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row as { house_code: string; house_number: string };
}

export async function rotateHouseCode(houseId: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_house_code', { p_house_id: houseId });
  if (error) throw new Error(error.message);
  return data as unknown as string;
}

// ─── codes ───────────────────────────────────────────────────────────────────

export async function listCodes(estateId: string, limit = 100): Promise<CodeRow[]> {
  const { data, error } = await supabase
    .from('access_codes')
    .select('id, code, created_at, expires_at, status, memberships!access_codes_membership_id_fkey(unit, profiles(full_name))')
    .eq('estate_id', estateId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return (data ?? []).map((c) => {
    const m = c.memberships as
      | { unit: string | null; profiles: { full_name: string | null } | null }
      | null;
    return {
      id: c.id,
      code: c.code,
      created_at: c.created_at,
      expires_at: c.expires_at,
      status: displayStatus({ status: c.status, expires_at: c.expires_at }),
      owner_name: m?.profiles?.full_name ?? 'Unknown',
      owner_unit: m?.unit ?? null,
    };
  });
}

export type RevokeResult = 'ok' | 'not_found' | 'already_used' | 'already_revoked';

export async function revokeCode(codeId: string): Promise<RevokeResult> {
  const { data, error } = await supabase.rpc('revoke_access_code', { p_code_id: codeId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return (row?.result ?? 'not_found') as RevokeResult;
}

// ─── audit ───────────────────────────────────────────────────────────────────

export async function listEvents(estateId: string, limit = 100): Promise<EventRow[]> {
  // Ordered by synced_at, NEVER verified_at: verified_at is the device's claim
  // and one phone with a wrong clock would poison the ordering permanently
  // (§10). verified_at is what humans read; synced_at is what sorts.
  const { data, error } = await supabase
    .from('verification_events')
    // One string LITERAL, not a concatenation: supabase-js infers the row type
    // by parsing this at the type level, and `'a' + 'b'` widens to `string`,
    // which collapses the result to GenericStringError.
    .select(
      'id, code_attempted, outcome, reject_reason, verified_at, synced_at, source, memberships!verification_events_verified_by_membership_id_fkey(profiles(full_name)), access_codes(memberships!access_codes_membership_id_fkey(unit, profiles(full_name)))',
    )
    .eq('estate_id', estateId)
    .order('synced_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return (data ?? []).map((e) => {
    const guard = e.memberships as { profiles: { full_name: string | null } | null } | null;
    const code = e.access_codes as {
      memberships: { unit: string | null; profiles: { full_name: string | null } | null } | null;
    } | null;
    return {
      id: e.id,
      code: e.code_attempted,
      outcome: e.outcome,
      reject_reason: e.reject_reason,
      verified_at: e.verified_at,
      synced_at: e.synced_at,
      source: e.source,
      guard_name: guard?.profiles?.full_name ?? 'Unknown guard',
      host_name: code?.memberships?.profiles?.full_name ?? null,
      host_unit: code?.memberships?.unit ?? null,
    };
  });
}

export async function rotateJoinCode(estateId: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_estate_join_code', {
    p_estate_id: estateId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as string;
}
