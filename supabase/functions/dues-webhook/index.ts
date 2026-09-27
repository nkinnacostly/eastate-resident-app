// Flutterwave webhook.
//
// ─── What actually secures this ──────────────────────────────────────────────
//
// Not the `verif-hash` header. In v3 that header carries your dashboard secret
// VERBATIM on every call -- it is a shared password, not a signature over the
// payload. It is therefore not tamper-evident (the body can say anything) and
// not replay-resistant (no timestamp, no nonce), and anyone who ever sees one
// request has it permanently.
//
// So it is treated as what it is: a cheap spam filter. The real control is that
// nothing here credits anything from the request body. We take the transaction
// id, re-query Flutterwave, and settle on THEIR answer -- which is their own
// documented instruction: "Before giving value to a customer based on a webhook
// notification, always re-query our API to verify the transaction details."
//
// ─── Why it almost always returns 200 ────────────────────────────────────────
//
// Flutterwave retries any non-200 three times at 30-minute intervals and cares
// about nothing but the status code. A 500 on a payload we have correctly
// decided to ignore buys 90 minutes of pointless retries. So: 200 for anything
// we have handled OR deliberately declined, non-2xx only when a retry might
// genuinely help.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { secretMatches, verifyTransaction } from '../_shared/flutterwave.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_HASH = Deno.env.get('FLUTTERWAVE_WEBHOOK_HASH');

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  if (!secretMatches(req.headers.get('verif-hash'), WEBHOOK_HASH)) {
    // 401, not 200: an unsigned request is not something we have decided about,
    // and if it IS Flutterwave with a rotated secret we want the retries.
    return new Response('unauthorised', { status: 401 });
  }

  const payload = await req.json().catch(() => null);
  if (!payload) return new Response('ok', { status: 200 });

  // Branch on data.status, NEVER on the event name. `charge.completed` means
  // "the attempt finished" -- a declined card sends the same event with
  // data.status 'failed'.
  const data = payload?.data ?? {};
  const txRef: string | undefined = data.tx_ref;
  const providerTxId = data.id != null ? String(data.id) : undefined;

  if (!txRef && !providerTxId) return new Response('ok', { status: 200 });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const verified = await verifyTransaction({ transactionId: providerTxId, txRef });
    if (!verified) {
      // Flutterwave does not know this transaction. Nothing to credit, and
      // retrying will not change their answer.
      console.warn('[dues-webhook] verify returned nothing', { txRef, providerTxId });
      return new Response('ok', { status: 200 });
    }

    // Their answer for their reference. If the body claimed one tx_ref and the
    // verified transaction carries another, the body was lying -- which is
    // exactly the substitution `verif-hash` cannot detect.
    const { data: result, error } = await admin.rpc('settle_dues_payment', {
      p_tx_ref: verified.txRef,
      p_provider_tx_id: verified.providerTxId,
      p_amount_minor: verified.amountMinor,
      p_currency: verified.currency,
      p_provider_status: verified.status,
      p_raw: verified.raw,
    });

    if (error) {
      // A database failure is the one case a retry genuinely helps.
      console.error('[dues-webhook] settle failed', error.message);
      return new Response('settle failed', { status: 500 });
    }

    // Mismatches are logged loudly and answered 200. They are decisions, not
    // failures: retrying an amount mismatch thirty minutes later produces the
    // same mismatch. Both are worth an alert -- a genuine amount mismatch means
    // someone tampered, or our charge changed under a payment in flight.
    if (result === 'amount_mismatch' || result === 'currency_mismatch') {
      console.error('[dues-webhook] MISMATCH', { result, txRef: verified.txRef });
    } else if (result === 'unknown_reference') {
      console.warn('[dues-webhook] reference we never issued', verified.txRef);
    } else {
      console.info('[dues-webhook]', result, verified.txRef);
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    // A timeout against Flutterwave is NOT a failed payment -- their system
    // waits 28 seconds before giving up and the charge may well have gone
    // through. Never infer failure from it. 500 so they retry; the
    // reconciliation sweep is the backstop if they stop.
    console.error('[dues-webhook]', (e as Error).message);
    return new Response('verify failed', { status: 500 });
  }
});
