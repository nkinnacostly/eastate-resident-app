// Transactional email through MyDomainsHub Mail — the one place that talks to
// the provider. send-emails, auth-emails and request-password-reset all send
// through here, so a provider change is a change to this file.
//
// Checked against emails.mydomainshub.com/docs and /api/v1/openapi.json
// (OpenAPI 3.1, API version 1) on 8 Oct 2026:
//
//   POST /api/v1/emails, Authorization: Bearer mdh_live_…
//   body  { from, to, subject, html, text, reply_to }
//         — additionalProperties: false, so an unknown field is a 422, not
//           silently ignored. Send only what the schema names.
//   200   { id } — QUEUED, not delivered. Their worker sends it afterwards.
//   error { name, message } with the status; the message never quotes an
//         address, subject or body, so it is safe to log.
//
// Sent FROM no-reply@, with Reply-To hello@. hello@ is the support mailbox
// people write to; it must never send, so a bounce, an auto-reply or a spam
// complaint about bulk mail never lands on — or reflects on — the address
// residents rely on to reach us. The templates still say "reply to this
// message", and that stays true: the reply goes to hello@.
//
// Constants, not env: these are the product's identity, and a stale secret
// overriding them is exactly how mail would quietly start going out from the
// support address again.

import type { RenderedEmail } from './email-templates.ts';

const ENDPOINT = 'https://emails.mydomainshub.com/api/v1/emails';

export const MAIL_API_KEY = Deno.env.get('DOMAINHUB_API_KEY');
/** Sends only. Nobody reads it. */
export const FROM_EMAIL = 'no-reply@myestateaccess.com';
/** The visible sender. A bare address reads as machinery; a name reads as a product. */
export const FROM = `myestateaccess <${FROM_EMAIL}>`;
/** The support mailbox. Where replies land; it receives and never sends. */
export const REPLY_TO = 'hello@myestateaccess.com';

export interface SendResult {
  /** Accepted by the provider — now, or by an earlier request with the same key. */
  sent: boolean;
  /** Only meaningful when !sent: could the same request succeed later? */
  retryable: boolean;
  status: number;
  /** The provider's id for the email, when this request queued it. */
  id?: string;
  detail?: string;
}

/**
 * Responses worth trying again.
 *
 * The test is not "was it an error" but "could a later attempt succeed without
 * this message changing" — the same distinction that decides InvalidCredentials
 * in the push dispatcher, and it is easy to get wrong in the same way.
 *
 *   401 unauthorized — bad or missing API key. Fixed by a human, not by the
 *       message being different.
 *   403 domain_not_verified / account_paused / forbidden — the from domain's
 *       DNS is unfinished, sending is paused, the account is still in the
 *       sandbox, or (per their docs) a new account is still being set up. All
 *       of them clear without the message changing. Dropping them would mean
 *       the first estate onboarded before the domain was verified never gets
 *       its welcome email, and nobody would ever know.
 *   429 rate_limited / quota_exceeded — 10 req/s per key, or the plan's daily
 *       or monthly cap (Lagos time).
 *   5xx internal_error.
 *
 * A 422 validation_error (and 413, too large) is deliberately absent: a
 * malformed recipient fails identically forever, and retrying it blocks the
 * queue behind a message that can never leave it.
 */
const RETRYABLE_STATUS = new Set([401, 403, 429, 500, 502, 503, 504]);

/**
 * Their keys are 1–256 printable ASCII characters with no spaces. Ours are
 * built from ids plus, for dues reminders, the recipient's address, which can
 * be long or non-ASCII. Hash anything outside the rule rather than have the
 * provider refuse the email with a 422 that no retry can fix.
 */
async function providerSafeKey(key: string): Promise<string> {
  if (/^[\x21-\x7e]{1,256}$/.test(key)) return key;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256-${hex}`;
}

/**
 * Send one email. Throws only on a network failure, where nobody knows whether
 * it arrived; every answer the provider gives comes back as a SendResult.
 *
 * With `idempotencyKey`, the same key and the same request within 24 hours is
 * sent once. Leave it out where two calls must mean two emails.
 */
export async function sendEmail(
  to: string,
  email: RenderedEmail,
  opts: { idempotencyKey?: string } = {},
): Promise<SendResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${MAIL_API_KEY}`,
    'Content-Type': 'application/json',
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = await providerSafeKey(opts.idempotencyKey);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: email.subject,
      html: email.html,
      // Always both parts. An HTML-only message is a strong spam signal and
      // renders as nothing at all in a text-only client.
      text: email.text,
      reply_to: REPLY_TO,
    }),
  });

  const raw = await res.text();
  let body: { id?: string; name?: string; message?: string } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    // A proxy's HTML error page, most likely. The status still classifies it.
  }

  if (res.ok) return { sent: true, retryable: false, status: res.status, id: body.id };

  const requestId = res.headers.get('x-request-id');
  const detail = `${res.status} ${body.name ?? 'unknown'}: ${body.message ?? raw.slice(0, 200)}`
    + (requestId ? ` (request ${requestId})` : '');

  // 409 on a send means this key was already used by a request they ACCEPTED
  // — "a refused request is not remembered". So the email has gone; what
  // differs is the body, e.g. a dues reminder re-rendered a day later with a
  // new "due in N days". Reporting that as a failure would log a false alarm
  // for mail that was delivered.
  if (res.status === 409 && opts.idempotencyKey) {
    return { sent: true, retryable: false, status: res.status, detail };
  }

  return { sent: false, retryable: RETRYABLE_STATUS.has(res.status), status: res.status, detail };
}
