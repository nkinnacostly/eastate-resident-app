// Pay a house charge from a link, with no account.
//
// THE LANDLORD PATH. `houses` stores landlord_name/phone/email as data and says
// outright that a landlord never signs in, so there is no account for them to
// authenticate with and no membership to derive. The pay token IS the
// authorisation.
//
// That is not a hole in the identity rule, which exists to stop a caller
// ASSERTING who they are. A bearer token over one charge asserts nothing about
// identity: it authorises settling one specific bill, it is unguessable
// (18 random bytes), and the worst a holder can do is pay someone's dues. It
// also works for the cases an account never would -- a tenant settling on the
// landlord's behalf, or a managing agent paying a portfolio.
//
// verify_jwt = false in config.toml, necessarily: there is no JWT.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { createCheckout } from '../_shared/flutterwave.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_URL = Deno.env.get('DUES_REDIRECT_URL') ?? 'https://myestateaccess.com/dues/return';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const { pay_token, email } = await req.json().catch(() => ({}));
  if (!pay_token || typeof pay_token !== 'string') return json({ error: 'pay_token_required' }, 400);
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    // Flutterwave requires a customer email, and it is also where the receipt
    // goes. Asked for on the pay page rather than taken from the house record,
    // because the person paying is often not the landlord we have on file.
    return json({ error: 'email_required' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await admin.rpc('start_dues_payment_by_token', {
    p_pay_token: pay_token,
    p_payer_email: email,
  });
  if (error) return json({ error: error.message }, 400);

  const row = Array.isArray(data) ? data[0] : data;
  // Same response for a bad token and a settled charge, deliberately: a
  // distinguishable answer turns this endpoint into an oracle for guessing
  // valid tokens.
  if (!row?.ok) return json({ error: 'charge_unavailable' }, 404);

  try {
    const link = await createCheckout({
      txRef: row.tx_ref,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      redirectUrl: `${SITE_URL}?ref=${encodeURIComponent(row.tx_ref)}`,
      email,
      title: `${row.estate_name} dues`,
      description: `Monthly dues, house ${row.house_number ?? ''}`.trim(),
    });
    return json({ link, tx_ref: row.tx_ref });
  } catch (e) {
    console.error('[dues-pay]', (e as Error).message);
    return json({ error: 'checkout_unavailable' }, 502);
  }
});
