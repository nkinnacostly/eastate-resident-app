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
import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  createSubaccount,
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

type Country = 'NG' | 'ZA';
const isCountry = (v: unknown): v is Country => v === 'NG' || v === 'ZA';

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

  if (action === 'read') return json({ settlement: existing ?? null });

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
    // South Africa has no name lookup, so a null here is expected and is not a
    // rejection. Nigeria does, so a null there means the account is not real.
    if (country === 'ZA') {
      return json({ account_name: null, verified: false, unverifiable: true });
    }
    return json({ error: 'invalid_account' }, 400);
  }

  if (action !== 'save') return json({ error: 'unknown_action' }, 400);

  const { bank_code, bank_name, account_number, country, account_name } = body;
  if (!isCountry(country) || !bank_code || !account_number) {
    return json({ error: 'bank_code_account_number_country_required' }, 400);
  }

  // Re-resolved here rather than trusting the name the browser sends back from
  // the resolve step. Otherwise the confirmation is theatre: a caller could
  // show one name to the admin and save another.
  const resolved = await resolveAccountName(String(account_number), String(bank_code));
  if (!resolved && country === 'NG') return json({ error: 'invalid_account' }, 400);
  if (!resolved && !account_name) return json({ error: 'account_name_required' }, 400);

  const finalName = resolved ?? String(account_name);
  const verified = Boolean(resolved);

  // The estate's own name on the subaccount, so it is recognisable in the
  // Flutterwave dashboard and on the payer's statement.
  const { data: estateRow } = await asUser
    .from('estates').select('name').eq('id', estateId).maybeSingle();
  const estateName = estateRow?.name ?? 'Estate';

  let made: { id: string; ref: string; bankName: string | null } | null = null;
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

    return json({
      ok: true,
      account_name: finalName,
      verified,
      bank_name: made.bankName ?? bank_name ?? null,
    });
  } catch (e) {
    // Roll back the subaccount if the database write failed. Leaving it behind
    // would litter the Flutterwave account with orphans nothing references,
    // and one of them pointing at a real bank account is a payout destination
    // with no record of why it exists.
    if (made) await deleteSubaccount(made.id).catch(() => {});
    console.error('[estate-settlement] save', (e as Error).message);
    return json({ error: 'could_not_save_settlement' }, 502);
  }
});
