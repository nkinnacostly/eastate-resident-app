/**
 * Platform-owner reads.
 *
 * Every call here is an RPC, not a table read. The operator's job is to look
 * across estates, and the alternative — an `or is_platform_admin()` arm on the
 * RLS policy of every table — would leave a cross-tenant read path open on the
 * whole schema for the sake of these screens. See 20260815170000.
 */
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
}): Promise<OnboardResult> {
  const { data, error } = await supabase.functions.invoke<OnboardResult & { error?: string; detail?: string }>(
    'onboard-estate',
    { body: input },
  );

  // functions.invoke reports a non-2xx as a FunctionsHttpError whose message is
  // just the status, so the useful part has to be read off the response body.
  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(detail ?? error.message);
  }
  if (!data || (data as { error?: string }).error) {
    throw new Error(describe((data as { error?: string })?.error ?? 'unknown_error'));
  }
  return data;
}

async function readFunctionError(error: unknown): Promise<string | null> {
  const res = (error as { context?: Response }).context;
  if (!res || typeof res.json !== 'function') return null;
  try {
    const body = await res.json();
    return describe(body?.error ?? '') + (body?.detail ? ` — ${body.detail}` : '');
  } catch {
    return null;
  }
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
