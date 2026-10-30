// Tell us where an estate's dues should be paid.
//
// An estate admin gives us a bank account; we prove it exists, build a
// Flutterwave subaccount against it, prove THAT exists, and only then record
// it. From that point every dues payment settles into the estate's own account
// and never touches ours.
//
// ─── Why this cannot be a plain RPC ──────────────────────────────────────────
//
// Two reasons, both about the secret key:
//
//   * Resolving an account name and creating a subaccount are Flutterwave
//     calls, and the secret key can do anything on the account. It lives in
//     Edge Function secrets and nowhere else.
//   * set_estate_settlement is revoked from `authenticated` precisely so that
//     an admin cannot name their own subaccount reference. They supply bank
//     details; the server derives the reference from them. That is what makes
//     the stored reference provably the account whose number we also stored.
//
// ─── The ordering is the safety property ─────────────────────────────────────
//
// resolve → create → FETCH BACK → store. The fetch-back is not paranoia: a
// charge naming a non-existent subaccount returns 200 and a payable link, and
// the money silently lands in the platform balance. The payment path will never
// report a bad reference, so this is the only place it can be caught. If the
// fetch-back fails we delete what we made and store nothing, because a
// subaccount we cannot verify is worse than none at all -- none at all is
// refused loudly by the database.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  createSubaccount,
  isTestKey,
  deleteSubaccount,
  getSubaccount,
  listBanks,
  resolveAccountName,
} from '../_shared/flutterwave.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Payout accounts are Nigerian (20261030160000). `country` stays in the request
// so the contract is unchanged, and anything but NG is refused.
type Country = 'NG';
const isCountry = (v: unknown): v is Country => v === 'NG';

/**
 * One email per estate admin and platform operator, through the queue.
 *
 * A single estate admin can repoint every future dues payment, and the audit
 * row alone tells nobody. Addresses come from auth.users via the service role;
 * the account number goes out as its last four digits only.
 */
async function alertSettlementChange(
  admin: SupabaseClient,
  c: {
    estateId: string; estateName: string; bankName: string | null; accountNumber: string;
    accountName: string; subaccountRef: string; changedBy: string;
  },
): Promise<void> {
  const [{ data: admins }, { data: operators }] = await Promise.all([
    admin.from('memberships').select('user_id').eq('estate_id', c.estateId).eq('role', 'admin').eq('is_active', true),
    admin.from('platform_admins').select('user_id'),
  ]);
  const ids = [...new Set([...(admins ?? []), ...(operators ?? [])].map((r) => r.user_id as string))];
  const emails = new Set<string>();
  for (const id of ids) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emails.add(data.user.email.toLowerCase());
  }
  const changedAt = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }) + ' (Lagos)';
  for (const to of emails) {
    await admin.rpc('enqueue_email', {
      p_kind: 'settlement_changed',
      p_payload: {
        to,
        estate_id: c.estateId,
        estate_name: c.estateName,
        bank_name: c.bankName,
        account_last4: c.accountNumber.slice(-4),
        account_name: c.accountName,
        subaccount_ref: c.subaccountRef,
        changed_by: c.changedBy,
        changed_at: changedAt,
      },
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorised' }, 401);

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  // The caller's own token. Identity comes from the JWT Supabase verified, not
  // from anything in the request body.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await asUser.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: 'unauthorised' }, 401);

  // ─── banks: populate the dropdown ──────────────────────────────────────────
  if (action === 'banks') {
    if (!isCountry(body?.country)) return json({ error: 'country_required' }, 400);
    try {
      return json({ banks: await listBanks(body.country) });
    } catch (e) {
      console.error('[estate-settlement] banks', (e as Error).message);
      return json({ error: 'banks_unavailable' }, 502);
    }
  }

  const estateId = body?.estate_id;
  if (!estateId) return json({ error: 'estate_id_required' }, 400);

  // Authorisation through the caller's own token: estate_settlement() raises
  // 42501 unless they are an admin of THIS estate. Doing it by calling a
  // function that already enforces it, rather than re-deriving the rule here,
  // keeps one definition of "admin of this estate".
  const { data: current, error: readErr } = await asUser.rpc('estate_settlement', {
    p_estate_id: estateId,
  });
  if (readErr) return json({ error: 'not_an_admin_at_this_estate' }, 403);

  const existing = Array.isArray(current) ? current[0] : current;

  // `test_mode` rides along so the dashboard can say so plainly. An admin
  // typing their real account into a sandbox-backed form gets a rejection they
  // cannot act on, and no amount of care with the account number fixes it.
  if (action === 'read') {
    return json({ settlement: existing ?? null, test_mode: isTestKey() });
  }

  // ─── resolve: show the admin whose account this is, before they commit ─────
  //
  // A separate step from saving so the confirmation is a real one. The admin
  // types a number, sees the name the bank has against it, and only then
  // agrees. Saving first and showing the name afterwards is the version where
  // a transposed digit is discovered a month later by the person who did not
  // receive the money.
  if (action === 'resolve') {
    const { bank_code, account_number, country } = body;
    if (!isCountry(country) || !bank_code || !account_number) {
      return json({ error: 'bank_code_account_number_country_required' }, 400);
    }
    const name = await resolveAccountName(String(account_number), String(bank_code));
    if (name) return json({ account_name: name, verified: true });
    // A null means the account is not real -- UNLESS we are on a sandbox key,
    // where the lookup only knows Flutterwave's own test accounts and every
    // real account fails the same way. Reporting "that number is wrong" there
    // is simply untrue.
    if (isTestKey()) return json({ error: 'test_mode_real_account' }, 400);
    return json({ error: 'invalid_account' }, 400);
  }

  if (action !== 'save') return json({ error: 'unknown_action' }, 400);

  const { bank_code, bank_name, account_number, country } = body;
  if (!isCountry(country) || !bank_code || !account_number) {
    return json({ error: 'bank_code_account_number_country_required' }, 400);
  }

  // Re-resolved here rather than trusting the name the browser sends back from
  // the resolve step. Otherwise the confirmation is theatre: a caller could
  // show one name to the admin and save another.
  const resolved = await resolveAccountName(String(account_number), String(bank_code));
  if (!resolved) {
    return json({ error: isTestKey() ? 'test_mode_real_account' : 'invalid_account' }, 400);
  }

  // Always the bank's name: every account here is checked before it is saved.
  const finalName = resolved;
  const verified = true;

  // The estate's own name on the subaccount, so it is recognisable in the
  // Flutterwave dashboard and on the payer's statement.
  const { data: estateRow } = await asUser
    .from('estates').select('name').eq('id', estateId).maybeSingle();
  const estateName = estateRow?.name ?? 'Estate';

  let made: { id: string; ref: string; bankName: string | null; created: boolean } | null = null;
  try {
    made = await createSubaccount({
      country,
      bankCode: String(bank_code),
      accountNumber: String(account_number),
      businessName: estateName,
      businessEmail: user.email ?? 'noreply@myestateaccess.com',
      feePercent: Number(existing?.fee_percent ?? 0),
    });

    // THE CHECK THAT MATTERS. Fetched back by NUMERIC id -- the RS_ reference
    // is not a valid key for this endpoint and always 404s. If this comes back
    // null the subaccount is not real, and storing its reference would produce
    // charges that silently settle to us.
    const confirmed = await getSubaccount(made.id);
    if (!confirmed) throw new Error('subaccount did not verify after creation');
    // getSubaccount always reports created:false, so keep the flag from the
    // create/adopt step -- it is what decides whether rollback may delete.
    confirmed.created = made.created;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { error } = await admin.rpc('set_estate_settlement', {
      p_estate_id: estateId,
      p_country: country,
      p_bank_code: String(bank_code),
      p_bank_name: made.bankName ?? (bank_name ? String(bank_name) : null),
      p_account_number: String(account_number),
      p_account_name: finalName,
      p_account_verified: verified,
      p_subaccount_ref: confirmed.ref,
      p_subaccount_id: confirmed.id,
      // Taken from the verified JWT, never from the request body. The database
      // uses it only to attribute the audit row.
      p_actor_user_id: user.id,
    });
    if (error) throw new Error(error.message);

    // Tell every admin and the platform operators. Best effort, and after
    // the save: a mail problem must not undo a payout account that is set.
    await alertSettlementChange(admin, {
      estateId,
      estateName,
      bankName: made.bankName ?? (bank_name ? String(bank_name) : null),
      accountNumber: String(account_number),
      accountName: finalName,
      subaccountRef: confirmed.ref,
      changedBy: user.email ?? 'an estate admin',
    }).catch((e) => console.error('[estate-settlement] alert', (e as Error).message));

    return json({
      ok: true,
      account_name: finalName,
      verified,
      bank_name: made.bankName ?? bank_name ?? null,
    });
  } catch (e) {
    // Roll back ONLY what we created. An orphan we made is litter; a
    // subaccount we merely adopted belongs to something else -- this estate's
    // Flutterwave account already had two against the same bank account, put
    // there by an unrelated product -- and deleting one would take down a
    // payout destination we do not own and cannot restore.
    if (made?.created) await deleteSubaccount(made.id).catch(() => {});
    console.error('[estate-settlement] save', (e as Error).message);
    return json({ error: 'could_not_save_settlement' }, 502);
  }
});
