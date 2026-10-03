/**
 * Detail views: one record with its history, on every dashboard.
 *
 * Every call is a definer RPC returning jsonb (20261001150000). The RPC decides
 * who may ask and what the answer may contain -- these types only describe it.
 * A null answer means "not found OR not yours", deliberately indistinguishable,
 * and every page renders it as not found.
 */
import { supabase } from './supabase';

export type ChargeStatus = 'open' | 'paid' | 'waived';

export interface ChargeItem {
  charge_id: string;
  period: string;
  amount_minor: number;
  currency: string;
  due_on: string;
  status: ChargeStatus;
  paid_at: string | null;
  waive_reason: string | null;
  /** 'house' for a landlord-billed house charge, 'resident' for a personal one. */
  subject?: 'house' | 'resident';
  resident_name?: string | null;
}

export interface CodeItem {
  id: string;
  code: string;
  created_at: string;
  expires_at: string;
  is_delivery: boolean;
  delivery_note: string | null;
  used_at: string | null;
  revoked_at: string | null;
  /** Derived server-side: an 'active' row past its expiry reads 'expired'. */
  status: 'active' | 'expired' | 'used' | 'revoked';
}

export interface ShiftItem {
  shift_id?: string;
  estate_name?: string;
  started_at: string;
  ended_at: string | null;
  ended_by_handover: boolean;
}

/** A gate entry as the operator sees it: hosts named, never the code. */
export interface GateEvent {
  id: string;
  verified_at: string;
  synced_at: string;
  outcome: string;
  reject_reason: string | null;
  source: string;
  flagged: boolean;
  estate_name: string;
  guard_name: string | null;
  host_name: string | null;
  host_unit: string | null;
}

// ─── Estate admin ────────────────────────────────────────────────────────────

export interface ResidentDetail {
  person: {
    membership_id: string;
    user_id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    last_sign_in_at: string | null;
    unit: string | null;
    house_id: string | null;
    house_number: string | null;
    is_active: boolean;
    joined_at: string;
    dues_payer: 'landlord' | 'resident';
  };
  stats: {
    live_codes: number;
    codes_30d: number;
    deliveries_30d: number;
    visitors_admitted_30d: number;
    last_code_at: string | null;
    in_arrears: boolean;
  };
  household: { membership_id: string; full_name: string; is_active: boolean }[];
  charges: ChargeItem[];
  codes: CodeItem[];
}

export interface HouseDetail {
  house: {
    house_id: string;
    house_number: string;
    house_code: string;
    is_active: boolean;
    created_at: string;
    landlord_name: string | null;
    landlord_phone: string | null;
    landlord_email: string | null;
    dues_payer: 'landlord' | 'residents' | null;
    dues_amount_minor: number | null;
    currency: string | null;
    grace_days: number | null;
    /** Set on the house itself, rather than inherited from the estate. */
    dues_payer_override: 'landlord' | 'residents' | null;
    dues_amount_override: number | null;
  };
  residents: {
    membership_id: string;
    full_name: string;
    phone: string | null;
    is_active: boolean;
    joined_at: string;
  }[];
  charges: ChargeItem[];
  stats: { codes_30d: number; visitors_admitted_30d: number };
}

// ─── Platform owner ──────────────────────────────────────────────────────────

export interface EstatePerson {
  membership_id: string;
  user_id: string;
  role: 'resident' | 'guard' | 'admin';
  full_name: string;
  email: string | null;
  phone: string | null;
  house_number: string | null;
  is_active: boolean;
  joined_at: string;
  last_sign_in_at: string | null;
}

export interface OperatorEstateDetail {
  estate: {
    id: string;
    name: string;
    address: string | null;
    contact_info: string | null;
    join_code: string | null;
    is_active: boolean;
    created_at: string;
  };
  counts: { houses: number; residents: number; guards: number; admins: number };
  gate_30d: {
    verifications: number;
    admitted: number;
    refused: number;
    offline: number;
    flagged: number;
    last_activity: string | null;
    on_duty_name: string | null;
    on_duty_since: string | null;
  };
  dues: {
    billing_mode: 'none' | 'per_house' | 'per_resident';
    amount_minor: number | null;
    currency: string | null;
    grace_days: number;
    enforcement_on: boolean;
    platform_fee_percent: number;
    outstanding_minor: number;
    open_charges: number;
    collected_30d_minor: number;
  };
  settlement: {
    bank_name: string | null;
    account_mask: string | null;
    account_name: string | null;
    verified: boolean | null;
    configured_at: string | null;
  };
  agencies: {
    agency_name: string;
    starts_on: string;
    ends_on: string | null;
    revoked_at: string | null;
    live: boolean;
  }[];
  people: EstatePerson[];
  houses: {
    house_id: string;
    house_number: string;
    is_active: boolean;
    landlord_name: string | null;
    dues_payer: 'landlord' | 'residents' | null;
    residents: number;
    outstanding_minor: number;
  }[];
  events: GateEvent[];
}

export interface GuardStats {
  membership_id: string;
  estate_name: string;
  is_active: boolean;
  on_duty_since: string | null;
  shifts_30d: number;
  hours_on_duty_30d: number;
  verifications_30d: number;
  admitted_30d: number;
  rejected_30d: number;
  offline_30d: number;
  flagged_30d: number;
  last_verification_at: string | null;
}

export interface OperatorPersonDetail {
  person: {
    user_id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    email_confirmed: boolean;
    last_sign_in_at: string | null;
    is_platform_admin: boolean;
    psira_registration_number: string | null;
    psira_grade: string | null;
    psira_expires_at: string | null;
    psira_verified_at: string | null;
  };
  memberships: {
    membership_id: string;
    estate_id: string;
    estate_name: string;
    role: 'resident' | 'guard' | 'admin';
    is_active: boolean;
    joined_at: string;
    house_number: string | null;
    agency_name: string | null;
  }[];
  agencies: { agency_name: string; role: string; is_active: boolean; joined_at: string }[];
  guard: GuardStats[];
  shifts: ShiftItem[];
  events: GateEvent[];
}

// ─── Agency ──────────────────────────────────────────────────────────────────

export interface AgencyOfficerDetail {
  officer: {
    agency_membership_id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    role: 'officer' | 'admin';
    is_active: boolean;
    joined_at: string;
    last_sign_in_at: string | null;
    psira_registration_number: string | null;
    psira_grade: string | null;
    psira_expires_at: string | null;
    psira_verified_at: string | null;
  };
  postings: {
    estate_id: string;
    estate_name: string;
    is_active: boolean;
    posted_at: string;
    on_duty_since: string | null;
  }[];
  stats_30d: { shifts: number; hours: number; admitted: number; refused: number; flagged: number };
  shifts: ShiftItem[];
}

export interface AgencyEstateDetail {
  estate: { id: string; name: string; address: string | null };
  contracts: { starts_on: string; ends_on: string | null; revoked_at: string | null; live: boolean }[];
  officers: {
    agency_membership_id: string | null;
    full_name: string;
    is_active: boolean;
    posted_at: string;
    on_duty: boolean;
  }[];
  monthly: {
    month: string;
    shifts: number;
    hours: number;
    admitted: number;
    refused: number;
    flagged: number;
  }[];
}

// ─── Landlord ────────────────────────────────────────────────────────────────

export interface LandlordHouseDetail {
  house: {
    house_id: string;
    house_number: string;
    estate_name: string;
    estate_contact: string | null;
    is_active: boolean;
    dues_payer: 'landlord' | 'residents' | null;
    dues_amount_minor: number | null;
    currency: string | null;
    grace_days: number | null;
    /** A count, never names -- see landlord_house_detail. */
    residents: number;
  };
  charges: ChargeItem[];
  payments: {
    created_at: string;
    settled_at: string | null;
    status: 'initiated' | 'successful' | 'failed' | 'abandoned';
    amount_minor: number;
    currency: string;
    months: number;
    covers_from: string;
    covers_until: string;
    /** How it was paid, never by whom -- unless it was the landlord. */
    paid_via: 'you' | 'resident' | 'pay_link';
  }[];
}

// ─── Fetchers ────────────────────────────────────────────────────────────────

// Each call names its RPC as a string literal: scripts/test-client-queries.mjs
// finds the functions the apps depend on by scanning the source for rpc calls
// with a quoted name, and a generic wrapper taking the name as a variable would
// hide them from it. (Do not quote an example call in this comment -- the
// scanner reads comments too, and goes looking for a function by that name.)
function unwrap<T>({ data, error }: { data: unknown; error: { message: string } | null }): T | null {
  if (error) throw new Error(error.message);
  return (data ?? null) as T | null;
}

export async function getResidentDetail(estateId: string, membershipId: string) {
  return unwrap<ResidentDetail>(await supabase.rpc('estate_resident_detail', {
    p_estate_id: estateId, p_membership_id: membershipId,
  }));
}

export async function getHouseDetail(estateId: string, houseId: string) {
  return unwrap<HouseDetail>(await supabase.rpc('estate_house_detail', {
    p_estate_id: estateId, p_house_id: houseId,
  }));
}

export async function getOperatorEstate(estateId: string) {
  return unwrap<OperatorEstateDetail>(await supabase.rpc('operator_estate_detail', {
    p_estate_id: estateId,
  }));
}

export async function getOperatorPerson(userId: string) {
  return unwrap<OperatorPersonDetail>(await supabase.rpc('operator_person_detail', {
    p_target_user_id: userId,
  }));
}

export async function getAgencyOfficer(agencyMembershipId: string) {
  return unwrap<AgencyOfficerDetail>(await supabase.rpc('agency_officer_detail', {
    p_agency_membership_id: agencyMembershipId,
  }));
}

export async function getAgencyEstate(agencyId: string, estateId: string) {
  return unwrap<AgencyEstateDetail>(await supabase.rpc('agency_estate_detail', {
    p_agency_id: agencyId, p_estate_id: estateId,
  }));
}

export async function getLandlordHouse(houseId: string) {
  return unwrap<LandlordHouseDetail>(await supabase.rpc('landlord_house_detail', {
    p_house_id: houseId,
  }));
}
