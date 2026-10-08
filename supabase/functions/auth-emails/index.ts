// Supabase Auth "Send Email Hook".
//
// When this hook is enabled, Supabase stops sending auth mail itself and POSTs
// here instead — so sign-up confirmation and password resets go out through
// our mail provider (_shared/mailer.ts), on our own domain, in our own design, with the templates living in
// this repo rather than in a dashboard text box nobody can review.
//
// That last point is why this exists rather than the simpler alternative of
// pointing Supabase's SMTP settings at the provider. SMTP would work, but the
// templates would then be dashboard state: unreviewable, unversioned, and
// exactly the kind of "configured by hand in a console" that the rest of this
// project deliberately avoids.
//
// It also removes a real production limit — Supabase's built-in email service
// is rate-limited to a handful of messages an hour and is explicitly not for
// production use.
//
// SENDING IS SYNCHRONOUS HERE, unlike the queue-driven send-emails function.
// Auth flows are interactive: someone is staring at a "check your inbox"
// screen. A minute of cron latency would be indistinguishable from the mail
// never arriving, and Supabase treats a non-2xx from this hook as a failed
// sign-up, so the user is told immediately rather than silently left waiting.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

import {
  emailChange,
  resetPassword,
  verifyEmail,
  verifyEmailCode,
  type RenderedEmail,
} from '../_shared/email-templates.ts';
import { emailChangeMails } from '../_shared/email-change.ts';
import { MAIL_API_KEY, sendEmail } from '../_shared/mailer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

/**
 * The signing secret from Auth → Hooks, as `v1,whsec_...`.
 *
 * The library wants the base64 part only. Without verification this endpoint is
 * an open relay: anyone who finds the URL could post a payload naming any
 * address and have our DKIM-signed domain deliver it.
 */
const HOOK_SECRET = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? '').replace('v1,whsec_', '');

interface HookPayload {
  user: { email: string; new_email?: string };
  email_data: {
    token: string;
    token_hash: string;
    /** Email change only. See _shared/email-change.ts for which goes where. */
    token_new?: string;
    token_hash_new?: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
  };
}

/**
 * Build the link the recipient clicks.
 *
 * It points at Supabase's /auth/v1/verify, which consumes the hash and then
 * redirects to `redirect_to`. Building it by hand from `token_hash` is the
 * documented approach — the payload carries no ready-made URL.
 */
function confirmUrl(d: HookPayload['email_data'], tokenHash = d.token_hash): string {
  const params = new URLSearchParams({
    token: tokenHash,
    type: d.email_action_type,
    redirect_to: d.redirect_to || d.site_url,
  });
  return `${SUPABASE_URL}/auth/v1/verify?${params.toString()}`;
}

async function send(to: string, email: RenderedEmail): Promise<void> {
  const r = await sendEmail(to, email);
  if (!r.sent) throw new Error(`email send failed: ${r.detail}`);
}

Deno.serve(async (req) => {
  const raw = await req.text();

  let payload: HookPayload;
  try {
    if (!HOOK_SECRET) throw new Error('SEND_EMAIL_HOOK_SECRET not set');
    // Throws unless the signature, timestamp and body all agree.
    payload = new Webhook(HOOK_SECRET).verify(raw, {
      'webhook-id': req.headers.get('webhook-id')!,
      'webhook-timestamp': req.headers.get('webhook-timestamp')!,
      'webhook-signature': req.headers.get('webhook-signature')!,
    }) as HookPayload;
  } catch (e) {
    console.error('hook signature verification failed', e);
    return new Response(JSON.stringify({ error: { message: 'invalid signature' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // After the signature, not before: an unauthenticated caller learns nothing
  // about our configuration, not even that mail is broken.
  if (!MAIL_API_KEY) {
    console.error('DOMAINHUB_API_KEY not set');
    return new Response(JSON.stringify({ error: { message: 'email not configured' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { user, email_data: d } = payload;
  const url = confirmUrl(d);

  try {
    switch (d.email_action_type) {
      // Sign-up is code-ONLY, unlike the others below.
      //
      // The resident is finishing this inside the app, holding an estate code
      // and a house code that can only be spent once they have a session. A
      // link would confirm them in a browser, burn the one-time token, and
      // strand those two codes — so there is deliberately no link to click.
      // See verifyEmailCode.
      case 'signup':
        await send(user.email, verifyEmailCode({ otp: d.token }));
        break;

      // An email CHANGE is not the same journey: there are no join codes in
      // flight, and the person may well be doing it from a desktop, so the
      // link is still the shortest path. Each address gets its own code and
      // only its own — see _shared/email-change.ts before touching this.
      case 'email_change':
        for (const m of emailChangeMails(user, d)) {
          await send(m.to, emailChange({
            side: m.side,
            newEmail: user.new_email!,
            otp: m.otp,
            confirmUrl: confirmUrl(d, m.tokenHash),
          }));
        }
        break;

      case 'recovery':
        await send(user.email, resetPassword({ confirmUrl: url, otp: d.token }));
        break;

      case 'magiclink':
      case 'invite':
        // Same shape as a confirmation from the recipient's point of view:
        // click to prove the address is yours and land signed in.
        await send(user.email, verifyEmail({ confirmUrl: url, otp: d.token }));
        break;

      default:
        // An action type this build does not render — a notification about a
        // changed password, say. Returning 200 is deliberate: a non-2xx would
        // fail the underlying auth operation itself, so an unrecognised
        // NOTIFICATION would break the thing it was merely reporting on.
        console.warn('unhandled email_action_type, no mail sent', d.email_action_type);
    }
  } catch (e) {
    console.error('auth email send failed', d.email_action_type, e);
    return new Response(JSON.stringify({ error: { message: 'could not send email' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // The hook contract: empty 200.
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});
