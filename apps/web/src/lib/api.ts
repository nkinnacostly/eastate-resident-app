import { countsAgainstCap, displayStatus, type DisplayStatus } from '@estate/core';
import type { Json } from '@estate/db';

import type { HouseInput } from './csv';
import { callEdgeFunction } from './edge';
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
  /** The guard admitted this without the device matching a code. */
  admitted_without_match: boolean;
  /**
   * The names and the code were cut by the retention sweep.
   *
   * Carried as its own fact rather than inferred from the nulls, because an
   * admin reading "Unknown guard" goes looking for a bug. The entry is still
   * a true part of the register -- what happened, where and when -- it just no
   * longer says who. See 20260926100000_retention.sql.
   */
  de_identified: boolean;
}

/**
 * The guard used the admit-and-flag override.
 *
 * Lives beside EventRow rather than in a page, for two reasons. It is a fact
 * about the row, not about either screen that renders it -- the audit log and
 * the Flagged page must never disagree about how many entries need
 * reconciling. And exporting a non-component from a page file breaks React
 * Fast Refresh for that whole file, which is what oxlint's
 * react/only-export-components was pointing at.
 *
 * This used to be derived -- `admitted && offline_replay && !host_name` -- on
 * the argument that deriving beats a column that can drift from the event it
 * describes. The predicate was unsatisfiable: an event is only 'admitted'
 * because the conditional burn matched a code row, so code_id is never null
 * there, so the host always resolves. It is stored now, because the flag is a
 * fact about a decision a guard made at a gate holding a phone that knew
 * nothing (20260923100000_flagged_entries.sql).
 */
export function isFlagged(e: EventRow): boolean {
  return e.admitted_without_match;
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

// ─── guards ──────────────────────────────────────────────────────────────────

export interface OnboardGuardResult {
  estate_id: string;
  guard_user_id: string;
  email: string;
  full_name: string | null;
  /** Null when an existing account was reused — that person keeps their own. */
  password: string | null;
  reused_existing_account: boolean;
  welcome_email_queued: boolean;
}

/**
 * Registers a guard at this estate and returns their handover details.
 *
 * An Edge Function rather than an RPC for the same reason as estate
 * onboarding: minting an auth user needs the service role key, which bypasses
 * RLS and must never reach a browser bundle. The function re-checks that the
 * caller really administers `estateId` — the JWT proves who they are, not what
 * they may do, and the estate id travels from the client.
 */
export async function onboardGuard(input: {
  estate_id: string;
  email: string;
  full_name?: string;
  phone?: string;
}): Promise<OnboardGuardResult> {
  return callEdgeFunction<OnboardGuardResult>('onboard-guard', input, describeGuardError);
}

function describeGuardError(code: string): string {
  const map: Record<string, string> = {
    not_authenticated: 'You are signed out. Sign in again.',
    not_an_admin_at_this_estate: 'Only an administrator of this estate can register a guard.',
    estate_id_required: 'No estate selected.',
    email_required: 'The guard needs an email address.',
    email_invalid: 'That does not look like an email address.',
    lookup_failed: 'That address could not be checked.',
    create_user_failed: 'The guard account could not be created.',
    grant_membership_failed: 'The account exists but could not be attached to this estate.',
  };
  return map[code] ?? code;
}

/**
 * Who holds the gate right now, or null when nobody does.
 *
 * Reads the same `current_shift` the resident app uses, so the dashboard and
 * the residents' phones can never disagree about who is on duty.
 */
export interface CurrentShift {
  shift_id: string;
  guard_name: string;
  started_at: string;
}

export async function currentShift(estateId: string): Promise<CurrentShift | null> {
  const { data, error } = await supabase.rpc('current_shift', { p_estate_id: estateId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
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

export interface ImportedHouse {
  seq: number;
  house_number: string | null;
  house_code: string | null;
  /**
   * created   — new house, code is fresh
   * duplicate — already on the roll, code is the EXISTING one, nothing changed
   * invalid   — no house number in that row
   * failed    — a code collision; re-importing the file fixes it
   */
  status: 'created' | 'duplicate' | 'invalid' | 'failed';
}

/**
 * Import an estate roll in one call.
 *
 * Deliberately not a loop over createHouse: 300 round trips is slow, and a
 * browser that dies at row 180 leaves a half-built estate with no record of
 * where it stopped. The RPC reports a row per input, so a partial result is
 * still a complete account of what happened.
 */
export async function importHouses(
  estateId: string,
  houses: HouseInput[],
): Promise<ImportedHouse[]> {
  const { data, error } = await supabase.rpc('create_houses_bulk', {
    p_estate_id: estateId,
    // Cast: the generated type for a jsonb argument is Json, and an array of
    // object literals does not narrow to it on its own.
    p_houses: houses as unknown as Json,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ImportedHouse[];
}

export interface BulkApproval {
  request_id: string;
  status: 'approved' | 'failed';
  detail: string | null;
}

/**
 * Approve many join requests at once.
 *
 * The RPC loops over approve_join_request rather than reimplementing it, so
 * the per-request estate check still runs for every id. A request belonging to
 * another estate comes back 'failed'; it is never approved and never aborts
 * the rest of the batch.
 */
export async function approveRequests(requestIds: string[]): Promise<BulkApproval[]> {
  if (requestIds.length === 0) return [];
  const { data, error } = await supabase.rpc('approve_join_requests_bulk', {
    p_request_ids: requestIds,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as BulkApproval[];
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
      'id, code_attempted, outcome, reject_reason, verified_at, synced_at, source, admitted_without_match, de_identified_at, memberships!verification_events_verified_by_membership_id_fkey(profiles(full_name)), access_codes(memberships!access_codes_membership_id_fkey(unit, profiles(full_name)))',
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
      admitted_without_match: Boolean(e.admitted_without_match),
      de_identified: Boolean(e.de_identified_at),
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

// ─── Estate dues ─────────────────────────────────────────────────────────────

export interface DuesConfig {
  dues_billing_mode: 'none' | 'per_house' | 'per_resident';
  dues_amount_minor: number | null;
  dues_currency: string | null;
  dues_grace_days: number;
  dues_enforcement_authorised_at: string | null;
  dues_enforcement_basis: string | null;
}

export interface AdminDuesCharge {
  id: string;
  period: string;
  amount_minor: number;
  currency: string;
  due_on: string;
  status: 'open' | 'paid' | 'waived';
  paid_at: string | null;
  waive_reason: string | null;
  house_number: string | null;
  resident_name: string | null;
}



export async function getDuesConfig(estateId: string): Promise<DuesConfig> {
  const { data, error } = await supabase
    .from('estates')
    .select(
      'dues_billing_mode, dues_amount_minor, dues_currency, dues_grace_days, dues_enforcement_authorised_at, dues_enforcement_basis',
    )
    .eq('id', estateId)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as DuesConfig;
}

export async function listDuesCharges(estateId: string): Promise<AdminDuesCharge[]> {
  const { data, error } = await supabase
    .from('dues_charges')
    .select(
      'id, period, amount_minor, currency, due_on, status, paid_at, waive_reason, houses(house_number), memberships(profiles(full_name))',
    )
    .eq('estate_id', estateId)
    .order('period', { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const house = row.houses as { house_number: string } | null;
    const member = row.memberships as { profiles: { full_name: string | null } | null } | null;
    return {
      id: row.id as string,
      period: row.period as string,
      amount_minor: Number(row.amount_minor),
      currency: row.currency as string,
      due_on: row.due_on as string,
      status: row.status as AdminDuesCharge['status'],
      paid_at: (row.paid_at as string) ?? null,
      waive_reason: (row.waive_reason as string) ?? null,
      house_number: house?.house_number ?? null,
      resident_name: member?.profiles?.full_name ?? null,
    };
  });
}

export async function waiveDuesCharge(chargeId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('waive_dues_charge', {
    p_charge_id: chargeId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/**
 * Record — or withdraw — the estate's authority to withhold code generation.
 *
 * Separate from configuring an amount on purpose. Billing is an administrative
 * decision; restricting a service over arrears is a legal one, and in South
 * Africa the CSOS classifies a rule doing so as undesirable. An estate that has
 * not recorded a basis bills normally and restricts nobody.
 */
export async function setDuesEnforcement(
  estateId: string,
  authorised: boolean,
  basis?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_dues_enforcement', {
    p_estate_id: estateId,
    p_authorised: authorised,
    // undefined, not null: PostgREST omits an undefined argument so the
    // function's own `default null` applies, whereas an explicit null is a
    // different thing to send. The generated types caught this the moment the
    // temporary untyped accessor came out.
    p_basis: basis || undefined,
  });
  if (error) throw new Error(error.message);
}
