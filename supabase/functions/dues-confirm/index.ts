// Settle from the browser's return, as well as from the webhook.
//
// Both paths are required and neither is sufficient. Stripe puts the reason
// plainly and it applies verbatim here: "You can't rely on triggering
// fulfillment only from your Checkout landing page, because your customers
// aren't guaranteed to visit that page" -- and conversely Flutterwave's own
// retries are three attempts at 30-minute intervals, OFF BY DEFAULT until
// enabled in the dashboard.
//
// So this races the webhook, deliberately and routinely. It is safe because it
// calls the SAME settle RPC with the SAME reference: whichever arrives first
// credits, the other gets 'already_settled'. A separate "confirm" credit path
// would be a second way to give value and therefore a second way to double-pay.
//
// verify_jwt = false. The payer may be a landlord with no account -- that is
// the entire point of the pay link. The reference authorises nothing on its
// own: this endpoint only ever settles what Flutterwave itself reports as
// successful, so calling it with a guessed reference achieves nothing.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { verifyTransaction } from '../_shared/flutterwave.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

  const { tx_ref, transaction_id } = await req.json().catch(() => ({}));
  if (!tx_ref && !transaction_id) return json({ error: 'reference_required' }, 400);

  try {
    const v = await verifyTransaction({ transactionId: transaction_id, txRef: tx_ref });
    // Flutterwave does not know it, or it has not completed. Reported as
    // pending rather than failed: the person is looking at the page seconds
    // after paying, and a bank transfer can legitimately still be in flight.
    if (!v) return json({ status: 'pending' });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: result, error } = await admin.rpc('settle_dues_payment', {
      p_tx_ref: v.txRef,
      p_provider_tx_id: v.providerTxId,
      p_amount_minor: v.amountMinor,
      p_currency: v.currency,
      p_provider_status: v.status,
      p_raw: v.raw,
    });
    if (error) return json({ error: 'could_not_record' }, 500);

    // 'already_settled' is a SUCCESS to the person reading the page -- it means
    // the webhook beat them here, which is the common case on a fast network.
    const paid = result === 'settled' || result === 'already_settled' ||
                 result === 'settled_charge_already_paid';
    if (paid) return json({ status: 'paid' });
    if (result === 'recorded_failure') return json({ status: 'failed' });

    // A mismatch is not something to explain at a payment terminal. It is
    // logged for an admin and the payer is told to expect contact.
    console.error('[dues-confirm]', result, v.txRef);
    return json({ status: 'needs_review' });
  } catch (e) {
    console.error('[dues-confirm]', (e as Error).message);
    // A timeout against Flutterwave is not a failed payment; their system waits
    // 28 seconds before giving up. Never tell someone a payment failed on this.
    return json({ status: 'pending' });
  }
});
