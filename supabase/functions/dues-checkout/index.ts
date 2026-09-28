// Start a dues payment for a signed-in resident.
//
// Lives in an Edge Function for one reason: the Flutterwave secret key. It can
// do anything on the account and must never reach a browser bundle or a phone.
//
// The amount is NOT a parameter. It is read from the charge row by
// start_dues_payment, inside the database, which is the structural defence
// against a client choosing its own price -- the later verify comparison is the
// backstop, not the primary control.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { createCheckout } from '../_shared/flutterwave.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SITE_URL = Deno.env.get('DUES_REDIRECT_URL') ?? 'https://myestateaccess.com/dues/return';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorised' }, 401);

  const { charge_id, as_landlord } = await req.json().catch(() => ({}));
  if (!charge_id) return json({ error: 'charge_id_required' }, 400);

  // The caller's OWN token, deliberately -- not the service role. That keeps
  // start_dues_payment deriving identity from auth.uid(), so the ownership
  // check on the charge is made by the database against the real user rather
  // than by this function against something it was told.
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });

  // A landlord holds no membership at the estate, so the resident path's
  // current_membership() check would refuse them outright. Both functions
  // derive identity from auth.uid() -- the landlord one by way of the
  // CONFIRMED email on the account -- so this flag selects which OWNERSHIP
  // RULE applies, never who the caller is. Asking to be treated as a landlord
  // gets you nothing unless the estate recorded your address on the house.
  const { data, error } = as_landlord
    ? await supabase.rpc('start_landlord_dues_payment', { p_charge_id: charge_id })
    : await supabase.rpc('start_dues_payment', { p_charge_id: charge_id });
  if (error) return json({ error: error.message }, 400);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) return json({ error: row?.reason ?? 'could_not_start' }, 400);

  const { data: userData } = await supabase.auth.getUser();
  const email = userData?.user?.email;
  if (!email) return json({ error: 'no_email_on_account' }, 400);

  try {
    const link = await createCheckout({
      txRef: row.tx_ref,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      // tx_ref rides on the redirect so the return page can verify by reference
      // even when Flutterwave omits transaction_id, which it does on the
      // failure path.
      // `from=app` tells the return page to offer a way BACK into the app.
      // It is opened in an in-app browser whose back arrow returns to the
      // payment provider, not to us -- so without this a resident who has just
      // paid successfully is stranded on a confirmation screen with nothing to
      // press. The landlord path (dues-pay) deliberately omits it: someone
      // following an emailed link has no app to return to.
      redirectUrl: `${SITE_URL}?ref=${encodeURIComponent(row.tx_ref)}&from=app`,
      email,
      title: 'Estate dues',
      description: 'Monthly estate dues',
      // The estate's own bank account. start_dues_payment reads it from the
      // same row as the amount, so the destination cannot belong to a
      // different estate than the charge does.
      subaccountRef: row.subaccount_ref,
      feePercent: Number(row.fee_percent ?? 0),
    });
    // Only the link. The subaccount reference and our commission rate stay
    // server-side -- a resident has no use for either.
    return json({ link, tx_ref: row.tx_ref });
  } catch (e) {
    // The payment row stays 'initiated'. The reconciliation sweep will verify
    // it against Flutterwave rather than this function guessing: a checkout
    // that failed to create and one that created but whose response we lost
    // look identical from here.
    console.error('[dues-checkout]', (e as Error).message);
    return json({ error: 'checkout_unavailable' }, 502);
  }
});
