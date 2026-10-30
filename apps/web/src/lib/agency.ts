import { supabase } from './supabase';

/**
 * The agency portal's data layer.
 *
 * Everything here goes through a SECURITY DEFINER RPC rather than a table read,
 * and that is the design rather than an accident of typing. Widening RLS with
 * an `or is_agency_for(estate_id)` arm would put a permanent cross-tenant read
 * path on every table in the schema for the sake of these three screens; a
 * definer function is one reviewable door. See 20260926140000.
 *
 * Note what is NOT here and cannot be added without a migration: any call that
 * returns an individual gate event, a code, a resident or a house number. The
 * agency sees counts of its own service and a roster of its own staff. That is
 * a legal boundary, not a product preference -- an agency aggregating
 * identifiable visitor data across estates for its own purposes stops being an
 * operator and becomes responsible in its own right for it.
 */

export interface Agency {
  agency_id: string;
  name: string;
  registration_number: string | null;
  registration_body: string | null;
  registration_expires_at: string | null;
  /** When a HUMAN last checked the registration. Never set automatically. */
  registration_checked_at: string | null;
  role: 'officer' | 'admin';
}

export interface Coverage {
  estate_id: string;
  estate_name: string;
  contract_live: boolean;
  officers: number;
  shifts: number;
  hours: number;
  entries_admitted: number;
  entries_refused: number;
  entries_flagged: number;
}

export interface RosterRow {
  agency_membership_id: string;
  full_name: string | null;
  role: 'officer' | 'admin';
  is_active: boolean;
  registration_number: string | null;
  grade: string | null;
  registration_expires_at: string | null;
  registration_checked_at: string | null;
  estates_posted: number;
}

export interface ReturnRow {
  officer_name: string | null;
  registration_number: string | null;
  grade: string | null;
  contact_phone: string | null;
  registration_expires_at: string | null;
  registration_checked_at: string | null;
  estate_name: string;
  estate_address: string | null;
  first_shift_at: string;
  last_shift_at: string;
  shifts: number;
  hours: number;
}

/**
 * One cast, in one place, with a reason.
 *
 * packages/db types are generated FROM THE LIVE DATABASE, and the agency
 * migrations have not been applied to it yet -- the CLI is authenticated
 * against an account that cannot see this project. So supabase-js has no
 * knowledge of these function names and rejects them at the type level.
 *
 * Casting here rather than at six call sites keeps the untyped surface to a
 * single line that is easy to find and delete: once the migrations land and
 * `npm run db:types` runs, this helper can go and the calls below will type
 * themselves. The row shapes above are hand-written to match the SQL exactly
 * and are what the rest of the app sees, so the cast buys looseness only
 * between here and the wire.
 */
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const client = supabase as unknown as {
    rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>;
  };
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

/** Empty for a user who administers none — that is a routing answer, not an error. */
export async function myAgencies(): Promise<Agency[]> {
  return rpc<Agency>('my_agencies');
}

export async function listCoverage(agencyId: string, days = 30): Promise<Coverage[]> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  return rpc<Coverage>('agency_coverage_summary', {
    p_agency_id: agencyId,
    p_from: from,
    p_to: new Date().toISOString(),
  });
}

export async function listRoster(agencyId: string): Promise<RosterRow[]> {
  return rpc<RosterRow>('agency_roster', { p_agency_id: agencyId });
}

/** `month` is any date inside the month wanted; the server truncates it. */
export async function monthlyReturn(agencyId: string, month: Date): Promise<ReturnRow[]> {
  const iso = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`;
  return rpc<ReturnRow>('agency_monthly_return', { p_agency_id: agencyId, p_month: iso });
}

export async function recordRegistration(
  userId: string,
  registrationNumber: string,
  grade: string | null,
  expiresAt: string | null,
): Promise<void> {
  await rpc('record_psira_registration', {
    p_user_id: userId,
    p_registration_number: registrationNumber,
    p_grade: grade,
    p_expires_at: expiresAt,
  });
}

// ─── Compliance state ────────────────────────────────────────────────────────

/**
 * Whether this agency answers to South Africa's PSIRA.
 *
 * The guard-licence fields were first modelled on PSIRA (hence the psira_*
 * columns), but the product is built for Nigerian estates, where private guard
 * companies come under the NSCDC and there is no PSIRA number, A-E grade or
 * PSIRA monthly return. PSIRA's name and rules are shown only to an agency that
 * recorded PSIRA as its registration body; everyone else sees plain licence
 * wording. Estate and operator pages have no agency to ask, so they always do.
 */
export const answersToPsira = (agency: Pick<Agency, 'registration_body'> | null | undefined): boolean =>
  !!agency?.registration_body && /psira/i.test(agency.registration_body);

export type RegistrationState = 'missing' | 'expired' | 'expiring' | 'unchecked' | 'ok';

/**
 * How much weight a registration record can bear.
 *
 * `unchecked` is the state nobody else models and the one that matters most. An
 * unexpired date is a claim somebody typed in; it says nothing about a
 * registration suspended yesterday. Neither PSIRA nor the NSCDC publishes an
 * API to re-check against -- PSIRA's portal is a JavaScript shell over an
 * undocumented third-party endpoint and the NSCDC's does not resolve -- so the
 * only honest signal is how long ago a human looked.
 *
 * 90 days because PSIRA registration runs in 24-month cycles with renewal
 * opening 90 days before expiry: a check older than that could have missed a
 * whole renewal window.
 */
export function registrationState(row: {
  registration_number: string | null;
  registration_expires_at: string | null;
  registration_checked_at: string | null;
}): RegistrationState {
  if (!row.registration_number) return 'missing';

  const now = Date.now();
  if (row.registration_expires_at) {
    const expires = Date.parse(row.registration_expires_at);
    if (Number.isFinite(expires)) {
      if (expires < now) return 'expired';
      if (expires - now < 30 * 86_400_000) return 'expiring';
    }
  }

  if (!row.registration_checked_at) return 'unchecked';
  const checked = Date.parse(row.registration_checked_at);
  if (!Number.isFinite(checked) || now - checked > 90 * 86_400_000) return 'unchecked';

  return 'ok';
}

export const REGISTRATION_COPY: Record<RegistrationState, string> = {
  missing: 'No registration recorded',
  expired: 'Registration expired',
  expiring: 'Expires within 30 days',
  unchecked: 'Not checked recently',
  ok: 'Checked',
};
