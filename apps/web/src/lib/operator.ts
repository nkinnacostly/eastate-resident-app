/**
 * Platform-owner reads.
 *
 * Every call here is an RPC, not a table read. The operator's job is to look
 * across estates, and the alternative — an `or is_platform_admin()` arm on the
 * RLS policy of every table — would leave a cross-tenant read path open on the
 * whole schema for the sake of these screens. See 20260815170000.
 */
import { callEdgeFunction } from './edge';
import { supabase } from './supabase';

export interface Portfolio {
  estates_total: number;
  estates_live: number;
  estates_onboarding: number;
  houses_total: number;
  residents_total: number;
  guards_total: number;
  admins_total: number;
  verifications_30d: number;
  admitted_30d: number;
  rejected_30d: number;
  offline_30d: number;
  flagged_30d: number;
}

export interface OperatorEstate {
  id: string;
  name: string;
  address: string | null;
  join_code: string;
  is_active: boolean;
  created_at: string;
  houses: number;
  residents: number;
  guards: number;
  admin_name: string | null;
  admin_email: string | null;
  admin_count: number;
  verifications_30d: number;
  flagged_30d: number;
  last_activity: string | null;
}

export interface OperatorAdmin {
  user_id: string;
  full_name: string | null;
  email: string;
  estate_id: string;
  estate_name: string;
  is_active: boolean;
  granted_at: string;
  last_sign_in_at: string | null;
}

export interface PlatformMember {
  user_id: string;
  full_name: string | null;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface HealthRow {
  estate_id: string;
  estate_name: string;
  verifications_30d: number;
  offline_30d: number;
  offline_share: number;
  flagged_30d: number;
  median_lag_seconds: number | null;
  worst_lag_seconds: number | null;
  stale_pool_worst_age: number | null;
}

export interface VolumeDay {
  day: string;
  verifications: number;
  admitted: number;
  offline: number;
}

const unwrap = <T,>(data: unknown, error: { message: string } | null): T => {
  if (error) throw new Error(error.message);
  return data as T;
};

export async function getPortfolio(): Promise<Portfolio> {
  const { data, error } = await supabase.rpc('operator_portfolio');
  const rows = unwrap<Portfolio[]>(data, error);
  const row = Array.isArray(rows) ? rows[0] : (rows as unknown as Portfolio);
  if (!row) throw new Error('operator_portfolio returned no row');
  return row;
}

export async function listOperatorEstates(): Promise<OperatorEstate[]> {
  const { data, error } = await supabase.rpc('operator_estates');
  return unwrap<OperatorEstate[]>(data, error) ?? [];
}

export async function listOperatorAdmins(): Promise<OperatorAdmin[]> {
  const { data, error } = await supabase.rpc('operator_admins');
  return unwrap<OperatorAdmin[]>(data, error) ?? [];
}

export async function listPlatformTeam(): Promise<PlatformMember[]> {
  const { data, error } = await supabase.rpc('operator_platform_team');
  return unwrap<PlatformMember[]>(data, error) ?? [];
}

export async function listHealth(): Promise<HealthRow[]> {
  const { data, error } = await supabase.rpc('operator_health');
  return unwrap<HealthRow[]>(data, error) ?? [];
}

export async function listDailyVolume(days = 30): Promise<VolumeDay[]> {
  const { data, error } = await supabase.rpc('operator_daily_volume', { p_days: days });
  return unwrap<VolumeDay[]>(data, error) ?? [];
}

/**
 * One dues payment ATTEMPT, failures included. Provider fields are pulled out
 * of the stored payload server-side; the payload itself never reaches here.
 */
export interface DuesTransaction {
  payment_id: string;
  created_at: string;
  settled_at: string | null;
  status: 'initiated' | 'successful' | 'failed' | 'abandoned';
  estate_id: string;
  estate_name: string;
  house_number: string | null;
  charge_id: string;
  charge_period: string;
  charge_due_on: string;
  charge_status: string;
  billed_to: 'house' | 'resident';
  billed_name: string | null;
  payer_name: string | null;
  payer_email: string | null;
  payer_phone: string | null;
  /** 'resident' | 'admin' | 'guard' for an app payment; 'pay_link' for the emailed link. */
  paid_via: string;
  amount_minor: number;
  currency: string;
  charged_minor: number | null;
  provider_fee_minor: number | null;
  settled_minor: number | null;
  /** Null on payments made before the rate was recorded per payment. */
  platform_fee_percent: number | null;
  platform_fee_minor: number | null;
  tx_ref: string;
  provider: string;
  provider_tx_id: string | null;
  provider_ref: string | null;
  payment_type: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_issuer: string | null;
  processor_response: string | null;
  /** 1, 3, 6 or 12 -- how far ahead this payment settled. */
  months: number;
  /** First and last month covered. Equal for a one-month payment. */
  covers_from: string;
  covers_until: string;
}

/** Per estate, per currency — two currencies are never added together. */
export interface EstateDuesTotals {
  estate_id: string;
  estate_name: string;
  currency: string;
  payments: number;
  failed: number;
  collected_minor: number;
  platform_fee_minor: number;
  payers: number;
  outstanding_minor: number;
  open_charges: number;
  last_payment_at: string | null;
}

export async function listDuesTransactions(opts: {
  estateId?: string | null;
  since?: string | null;
} = {}): Promise<DuesTransaction[]> {
  const { data, error } = await supabase.rpc('operator_dues_payments', {
    p_estate_id: opts.estateId ?? undefined,
    p_since: opts.since ?? undefined,
  });
  return unwrap<DuesTransaction[]>(data, error) ?? [];
}

export async function listDuesByEstate(since?: string | null): Promise<EstateDuesTotals[]> {
  const { data, error } = await supabase.rpc('operator_dues_by_estate', {
    p_since: since ?? undefined,
  });
  return unwrap<EstateDuesTotals[]>(data, error) ?? [];
}

export interface OnboardResult {
  estate_id: string;
  estate_name: string;
  join_code: string | null;
  admin_email: string;
  admin_user_id: string;
  /** Null when an existing account was reused — that admin keeps their own. */
  password: string | null;
  reused_existing_account: boolean;
}

/**
 * Creates the estate AND its first admin account.
 *
 * An Edge Function rather than an RPC because minting an auth user needs the
 * service role key, which bypasses RLS and must never reach a browser bundle.
 * The function re-checks that the caller is a platform admin — the JWT proves
 * who they are, not what they may do.
 */
export async function onboardEstate(input: {
  estate_name: string;
  address?: string;
  contact_info?: string;
  admin_email: string;
  admin_name?: string;
  /** Chosen at onboarding because it decides what a blocked resident is shown. */
  dues_billing_mode?: 'none' | 'per_house' | 'per_resident';
  dues_amount_minor?: number;
  dues_currency?: string;
}): Promise<OnboardResult> {
  return callEdgeFunction<OnboardResult>('onboard-estate', input, describe);
}

/** Machine codes become sentences here, once, rather than at each call site. */
function describe(code: string): string {
  const map: Record<string, string> = {
    not_authenticated: 'You are signed out. Sign in again.',
    not_a_platform_admin: 'Only a platform owner can onboard an estate.',
    estate_name_required: 'The estate needs a name.',
    admin_email_required: 'The estate admin needs an email address.',
    admin_email_invalid: 'That does not look like an email address.',
    create_estate_failed: 'The estate could not be created.',
    create_user_failed: 'The admin account could not be created.',
    grant_membership_failed: 'The estate was created but the admin could not be attached to it.',
  };
  return map[code] ?? code;
}
