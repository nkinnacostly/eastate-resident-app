import { countsAgainstCap, displayStatus, type DisplayStatus } from '@estate/core';
import type { Json } from '@estate/db';

import type { HouseInput } from './csv';
import { callEdgeFunction } from './edge';
import type { DuesTransaction, EstateDuesTotals } from './operator';
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

/**
 * What onboard-guard did with the email it was given. Three outcomes:
 *
 *   - a NEW account: `invited` false, `password` set. Created on the spot and
 *     handed over in person.
 *   - an EXISTING account: `invited` true, `password` null. Nothing is
 *     attached -- the person is emailed an invitation and accepts it in the
 *     guard app, signed in as themselves. Until then they are not a guard here.
 *   - already a guard here: `invited` false, `password` null. Nothing to do.
 *
 * Typing someone's email used to make an existing account a guard at the
 * caller's estate without that person being asked. The invitation is what
 * replaced that, so `invited` -- not `reused_existing_account` -- is what
 * decides what the admin is told.
 */
export interface OnboardGuardResult {
  estate_id: string;
  /** Null unless a new account was created: nothing about an existing one comes back. */
  guard_user_id: string | null;
  email: string;
  /** For an existing account, only what the admin typed -- never the account's own name. */
  full_name: string | null;
  /** Set only for a new account. Anyone else keeps the password they already have. */
  password: string | null;
  /** True when an invitation was sent rather than a guard registered. */
  invited: boolean;
  /** Kept by the function for older dashboards; true for both null-password outcomes. */
  reused_existing_account: boolean;
  /** The welcome email for a new account, or the invitation email for an existing one. */
  welcome_email_queued: boolean;
}

export interface GuardProfile {
  membership_id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  joined_at: string;
  /** Null when the account has never been signed into -- a handover that never happened. */
  last_sign_in_at: string | null;
  agency_name: string | null;
  psira_registration_number: string | null;
  psira_grade: string | null;
  psira_expires_at: string | null;
  psira_verified_at: string | null;
  on_duty_since: string | null;
  shifts_30d: number;
  hours_on_duty_30d: number;
  last_shift_at: string | null;
  verifications_30d: number;
  admitted_30d: number;
  rejected_30d: number;
  offline_30d: number;
  flagged_30d: number;
  last_verification_at: string | null;
}

export interface GuardShift {
  shift_id: string;
  started_at: string;
  ended_at: string | null;
  ended_by_handover: boolean;
}

/** Null when the id is not a guard at this estate -- the page shows "not found", not someone else's guard. */
export async function getGuardProfile(
  estateId: string,
  guardMembershipId: string,
): Promise<GuardProfile | null> {
  const { data, error } = await supabase.rpc('estate_guard_profile', {
    p_estate_id: estateId,
    p_guard_membership_id: guardMembershipId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as GuardProfile | undefined) ?? null;
}

export async function listGuardShifts(
  estateId: string,
  guardMembershipId: string,
): Promise<GuardShift[]> {
  const { data, error } = await supabase.rpc('estate_guard_shifts', {
    p_estate_id: estateId,
    p_guard_membership_id: guardMembershipId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as GuardShift[];
}

/**
 * Registers a guard at this estate -- or, for an address that already has an
 * account, invites them -- and returns what happened.
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
    auth_check_failed: 'Could not confirm that you administer this estate. Try again.',
    estate_id_required: 'No estate selected.',
    email_required: 'The guard needs an email address.',
    email_invalid: 'That does not look like an email address.',
    lookup_failed: 'That address could not be checked.',
    create_user_failed: 'The guard account could not be created.',
    grant_membership_failed: 'The account exists but could not be attached to this estate.',
    invite_failed: 'That address already has an account, but the invitation could not be created.',
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

/** Who settles a house's dues. Null follows the estate's own billing mode. */
export type HouseDuesPayer = 'landlord' | 'residents';

export interface HouseRow {
  id: string;
  house_code: string;
  house_number: string;
  landlord_name: string | null;
  landlord_phone: string | null;
  landlord_email: string | null;
  is_active: boolean;
  residents: number;
  /** Null means this house follows the estate. Not a copy of it — a link. */
  dues_payer: HouseDuesPayer | null;
  /** Per RESIDENT when dues_payer is 'residents', never a total to split. */
  dues_amount_minor: number | null;
}

export async function listHouses(estateId: string): Promise<HouseRow[]> {
  const { data, error } = await supabase
    .from('houses')
    // ONE string literal, not a concatenation. supabase-js infers the row type
    // from the select text at compile time, and a built-up string defeats that
    // entirely -- `data` degrades to GenericStringError[] and every field on it
    // stops existing.
    .select('id, house_code, house_number, landlord_name, landlord_phone, landlord_email, is_active, dues_payer, dues_amount_minor')
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
  /**
   * The landlord's email, and it matters more than it looks.
   *
   * It was never collected here, and dues reminders to a landlord are EMAIL —
   * so every landlord-billed house added through this form was unreachable by
   * the one mechanism built to chase it. The bill would simply go nowhere.
   */
  landlordEmail = '',
  dues?: { payer: HouseDuesPayer | null; amountMinor: number | null },
): Promise<{ house_code: string; house_number: string }> {
  const { data, error } = await supabase.rpc('create_house', {
    p_estate_id: estateId,
    p_house_number: houseNumber,
    p_landlord_name: landlordName || undefined,
    p_landlord_phone: landlordPhone || undefined,
    p_landlord_email: landlordEmail || undefined,
    p_dues_payer: dues?.payer ?? undefined,
    p_dues_amount_minor: dues?.amountMinor ?? undefined,
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

export async function listEvents(
  estateId: string,
  limit = 100,
  /** Only this guard's verifications -- the guard profile's activity list. */
  guardMembershipId?: string,
): Promise<EventRow[]> {
  // Ordered by synced_at, NEVER verified_at: verified_at is the device's claim
  // and one phone with a wrong clock would poison the ordering permanently
  // (§10). verified_at is what humans read; synced_at is what sorts.
  let query = supabase
    .from('verification_events')
    // One string LITERAL, not a concatenation: supabase-js infers the row type
    // by parsing this at the type level, and `'a' + 'b'` widens to `string`,
    // which collapses the result to GenericStringError.
    .select(
      'id, code_attempted, outcome, reject_reason, verified_at, synced_at, source, admitted_without_match, de_identified_at, memberships!verification_events_verified_by_membership_id_fkey(profiles(full_name)), access_codes(memberships!access_codes_membership_id_fkey(unit, profiles(full_name)))',
    )
    .eq('estate_id', estateId);
  if (guardMembershipId) query = query.eq('verified_by_membership_id', guardMembershipId);
  const { data, error } = await query
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
    // `memberships` is NAMED via its constraint. dues_charges points at
    // memberships twice -- membership_id (who is billed) and
    // waived_by_membership_id (who waived it) -- so an inferred embed is
    // ambiguous and PostgREST refuses the whole query with 300 PGRST201.
    // We want the person BILLED, which is the first of those.
    .select(
      'id, period, amount_minor, currency, due_on, status, paid_at, waive_reason, houses(house_number), memberships!dues_charges_membership_id_fkey(profiles(full_name))',
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

/**
 * Who is billed and how much.
 *
 * Deliberately separate from setDuesEnforcement. Choosing a billing model is an
 * administrative decision an estate makes freely; withholding a service over
 * arrears is a legal one it has to justify. One call that did both would let
 * enforcement switch on as a side effect of editing an amount.
 */
export async function setDuesConfig(
  estateId: string,
  mode: DuesConfig['dues_billing_mode'],
  amountMinor: number | null,
  currency: string | null,
  graceDays: number,
): Promise<void> {
  const { error } = await supabase.rpc('set_dues_config', {
    p_estate_id: estateId,
    p_billing_mode: mode,
    p_amount_minor: amountMinor ?? undefined,
    p_currency: currency ?? undefined,
    p_grace_days: graceDays,
  });
  if (error) throw new Error(error.message);
}

/** Raise this month's charges now, rather than waiting for the 1st. */
export async function raiseCurrentDues(estateId: string): Promise<number> {
  const { data, error } = await supabase.rpc('raise_current_dues', { p_estate_id: estateId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Nudge whoever is responsible for a charge, now.
 *
 * Goes to the landlord AND to the residents of a house-billed charge: the
 * landlord has to pay it and the residents are the ones who get locked out.
 * Returns how many people were written to, which is the only honest thing to
 * report back — "sent" is meaningless when a house has no landlord on record.
 */
export async function remindDuesCharge(chargeId: string): Promise<number> {
  const { data, error } = await supabase.rpc('remind_dues_charge', {
    p_charge_id: chargeId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

// ─── Where an estate's dues are settled ──────────────────────────────────────
//
// Every one of these goes through the estate-settlement Edge Function rather
// than straight to an RPC, because resolving an account name and creating a
// Flutterwave subaccount need the secret key. set_estate_settlement is revoked
// from `authenticated` on purpose: if the browser could write the subaccount
// reference, an admin could point an estate's dues at any account at all.

export interface EstateSettlement {
  country: 'NG' | 'ZA' | null;
  bank_code: string | null;
  bank_name: string | null;
  /** Masked to the last four digits. The full number never leaves the server. */
  account_mask: string | null;
  account_name: string | null;
  /** True only where the bank confirmed the name — Nigeria. Never for ZA. */
  account_verified: boolean;
  configured_at: string | null;
  fee_percent: number;
  billing_mode: DuesConfig['dues_billing_mode'];
}

const settlementError = (code: string) =>
  ({
    invalid_account: 'That account number is not valid at the bank you chose. Check both and try again.',
    test_mode_real_account:
      'This platform is still on Flutterwave TEST keys, which can only look up '
      + 'Flutterwave’s own sandbox accounts — a real bank account will always be '
      + 'rejected here, however correct it is. To try the flow, use Access Bank '
      + 'with account number 0690000032. To add the estate’s real account, the '
      + 'live Flutterwave keys need to be deployed first.',
    not_an_admin_at_this_estate: 'You are not an administrator of this estate.',
    account_name_required: 'We could not verify this account, so please type the account name exactly as the bank has it.',
    banks_unavailable: 'We could not reach the bank list just now. Try again in a moment.',
    could_not_save_settlement: 'We could not set up the payout account. Nothing was saved — please try again.',
    bank_code_account_number_country_required: 'Choose a country and bank, and enter the account number.',
  })[code] ?? 'Something went wrong setting up the payout account.';

export async function listSettlementBanks(
  country: 'NG' | 'ZA',
): Promise<{ code: string; name: string }[]> {
  const r = await callEdgeFunction<{ banks: { code: string; name: string }[] }>(
    'estate-settlement',
    { action: 'banks', country },
    settlementError,
  );
  return r.banks;
}

export async function getEstateSettlement(
  estateId: string,
): Promise<{ settlement: EstateSettlement | null; testMode: boolean }> {
  const r = await callEdgeFunction<{ settlement: EstateSettlement | null; test_mode?: boolean }>(
    'estate-settlement',
    { action: 'read', estate_id: estateId },
    settlementError,
  );
  return { settlement: r.settlement, testMode: Boolean(r.test_mode) };
}

/**
 * Ask the bank who owns this account, before anything is saved.
 *
 * `verified: false` with no error is South Africa, where there is no name
 * lookup on the rail at all — it means "we could not check", NOT "this is
 * wrong". Nigeria either returns a name or throws, because there a failed
 * lookup does mean the account does not exist.
 */
export async function resolveSettlementAccount(
  estateId: string,
  country: 'NG' | 'ZA',
  bankCode: string,
  accountNumber: string,
): Promise<{ account_name: string | null; verified: boolean; unverifiable?: boolean }> {
  return callEdgeFunction(
    'estate-settlement',
    { action: 'resolve', estate_id: estateId, country, bank_code: bankCode, account_number: accountNumber },
    settlementError,
  );
}

export async function saveEstateSettlement(opts: {
  estateId: string;
  country: 'NG' | 'ZA';
  bankCode: string;
  bankName: string;
  accountNumber: string;
  /** Only used where the bank cannot confirm a name (South Africa). */
  accountName?: string;
}): Promise<{ account_name: string; verified: boolean }> {
  return callEdgeFunction(
    'estate-settlement',
    {
      action: 'save',
      estate_id: opts.estateId,
      country: opts.country,
      bank_code: opts.bankCode,
      bank_name: opts.bankName,
      account_number: opts.accountNumber,
      account_name: opts.accountName,
    },
    settlementError,
  );
}

/** Remove the payout account. Refused while dues are still being billed. */
export async function clearEstateSettlement(estateId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_estate_settlement', { p_estate_id: estateId });
  if (error) throw new Error(error.message);
}

// ─── A house's own dues terms ────────────────────────────────────────────────

/**
 * Change who pays for one house, and how much.
 *
 * Passing nulls clears the override and the house follows the estate again —
 * which is a link, not a copy, so a later change to the estate's rate reaches
 * it. Copying at the time of setting would quietly freeze a house at whatever
 * the estate charged that month.
 */
export async function setHouseDues(
  houseId: string,
  payer: HouseDuesPayer | null,
  amountMinor: number | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_house_dues', {
    p_house_id: houseId,
    p_payer: payer ?? undefined,
    p_amount_minor: amountMinor ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/**
 * Chase a whole house in one press.
 *
 * Where the landlord pays there is one charge. Where the RESIDENTS pay there
 * is a charge each, and an admin would otherwise have to find and press every
 * resident's row — tedious for three, half-done for six. Each person is
 * reminded about their own charge; naming a housemate's debt would share it
 * with people it does not belong to.
 *
 * Returns how many people were actually written to, which is the only honest
 * number: a house with no landlord email and no resident accounts reminds
 * nobody.
 */
export async function remindHouseDues(houseId: string): Promise<number> {
  const { data, error } = await supabase.rpc('remind_house_dues', { p_house_id: houseId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Every dues payment attempt at this estate -- residents' and landlords' alike,
 * failures included. The same rows the operator sees, scoped server-side to an
 * estate the caller actively administers.
 */
export async function listEstateDuesPayments(
  estateId: string,
  since: string | null,
): Promise<DuesTransaction[]> {
  const { data, error } = await supabase.rpc('estate_dues_payments', {
    p_estate_id: estateId,
    p_since: since ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as DuesTransaction[];
}

/** Complete totals for the window -- the transaction list is capped, these are not. */
export async function getEstateDuesTotals(
  estateId: string,
  since: string | null,
): Promise<EstateDuesTotals[]> {
  const { data, error } = await supabase.rpc('estate_dues_totals', {
    p_estate_id: estateId,
    p_since: since ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as EstateDuesTotals[];
}
