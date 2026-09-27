// Catch payments the webhook never told us about.
//
// Not optional, and not belt-and-braces. Flutterwave's own guidance: "Have a
// backup strategy in place in case your webhook endpoint fails... we recommend
// setting up a background job that polls for the status of any pending
// transactions at regular intervals."
//
// Their retries are also weaker than they look: three attempts at 30-minute
// intervals, and RETRIES ARE OFF BY DEFAULT until enabled in the dashboard. So
// a 90-minute outage can lose a payment permanently, and without this the first
// anyone would know is a resident locked out of their own gate having paid.
//
// It calls the SAME settle RPC as the webhook, with the same reference. That is
// what makes it safe to race a late webhook: whichever lands first credits, the
// other gets 'already_settled'. A separate "reconciliation credit" path would
// be a second way to give value, and therefore a second way to double-credit.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { verifyTransaction } from '../_shared/flutterwave.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: pending, error } = await admin.rpc('dues_payments_awaiting_verification', {
    p_older_than: '10 minutes',
  });
  if (error) {
    console.error('[dues-reconcile]', error.message);
    return new Response('query failed', { status: 500 });
  }

  const rows = (pending ?? []) as { tx_ref: string; provider_tx_id: string | null }[];
  let settled = 0;
  let stillPending = 0;

  for (const row of rows) {
    try {
      const v = await verifyTransaction({
        transactionId: row.provider_tx_id ?? undefined,
        txRef: row.tx_ref,
      });

      // Unknown to Flutterwave, or still in flight. Left ALONE, deliberately --
      // "initiated" and "paid but we never heard" are indistinguishable from
      // here, and marking it abandoned on a timer would close a payment that
      // may still land. The query stops offering it after three days.
      if (!v || v.status === 'pending') {
        stillPending++;
        continue;
      }

      await admin.rpc('settle_dues_payment', {
        p_tx_ref: v.txRef,
        p_provider_tx_id: v.providerTxId,
        p_amount_minor: v.amountMinor,
        p_currency: v.currency,
        p_provider_status: v.status,
        p_raw: v.raw,
      });
      settled++;
    } catch (e) {
      // One bad reference must not stop the sweep: the next row may be somebody
      // who paid and is locked out.
      console.error('[dues-reconcile]', row.tx_ref, (e as Error).message);
    }
  }

  // Emitted so it can be alerted on. A reconciliation job whose findings go
  // into a log nobody reads is a job that does not exist.
  console.info('[dues-reconcile]', { examined: rows.length, settled, stillPending });
  return new Response(JSON.stringify({ examined: rows.length, settled, stillPending }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
