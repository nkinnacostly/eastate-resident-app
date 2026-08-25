// Self-service password reset — the "send me a code" half.
//
// Mints a recovery token with the admin API and sends it through Resend, on the
// verified domain, using the repo's own template. The app then redeems the code
// with verifyOtp and sets a new password; nothing here changes a password, and
// nothing here returns a token to the caller.
//
// WHY NOT JUST supabase.auth.resetPasswordForEmail FROM THE APP
//
// Because the mail would not arrive in a usable form. With no Send Email Hook
// enabled, GoTrue sends through Supabase's built-in service: ~2 messages an
// hour, a default template that contains no code, and a link built from the
// project's Site URL — still the CLI default `http://localhost:3000`, which is
// a dead address on a phone. The token GoTrue mints is fine. The delivery is
// what is broken, so delivery is what this function takes over.
//
// The same generateLink-then-send-it-ourselves pattern already runs in
// onboard-estate for the estate admin welcome. This is that pattern, applied to
// the one flow where the alternative is a resident with no way back into their
// account.
//
// THIS ENDPOINT IS REACHABLE BY ANYONE HOLDING THE ANON KEY, which is compiled
// into the app and therefore public. Two things follow, and both are load
// bearing rather than defensive habit:
//
//   * It must not disclose whether an address has an account. Every path below
//     returns the same body. An endpoint that 404s on unknown addresses is a
//     free membership oracle for the entire user base.
//   * It must be rate limited, because it sends mail to an address chosen by
//     the caller. Without a limit it is a mail cannon that anyone can aim at a
//     stranger's inbox, with our DKIM signature on every round.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { resetPasswordCode } from '../_shared/email-templates.ts';

const RESEND_URL = 'https://api.resend.com/emails';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? 'hello@myestateaccess.com';
const FROM = `myestateaccess <${FROM_EMAIL}>`;

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

/**
 * The single response every caller gets.
 *
 * Unknown address, rate limited, Resend down, mail sent — all identical, and
 * deliberately so. The app says "if that address has an account, a code is on
 * its way", which is true in every one of those cases and informative in none.
 */
function ok(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function send(to: string, otp: string): Promise<void> {
  const email = resetPasswordCode({ otp });

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      // No Idempotency-Key here, unlike the queue dispatcher. Each request
      // mints a NEW token that invalidates the last one, so two requests must
      // produce two different emails — deduplicating them would send the
      // recipient a code that no longer works.
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      reply_to: FROM_EMAIL,
    }),
  });

  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 });
  }

  let email = '';
  try {
    const body = await req.json();
    email = String(body?.email ?? '').trim().toLowerCase();
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 });
  }

  // A malformed address is the one case that is safe to refuse outright: it
  // cannot belong to anybody, so saying so leaks nothing.
  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 });
  }

  if (!RESEND_API_KEY) {
    // Logged loudly, but the caller still gets the standard answer. Telling an
    // anonymous caller about our configuration is not their business.
    console.error('RESEND_API_KEY not set — cannot send reset code');
    return ok();
  }

  // Rate limit BEFORE minting. Minting first would invalidate the code the
  // caller was legitimately sent a moment ago, which turns a flood of requests
  // against someone else's address into a denial of their reset rather than
  // merely noise in their inbox.
  const { data: claim, error: claimError } = await admin.rpc('claim_password_reset', {
    p_email: email,
  });

  if (claimError) {
    console.error('claim_password_reset failed', claimError);
    return ok();
  }

  if (claim !== 'ok') {
    console.warn('password reset rate limited');
    return ok();
  }

  // Mints the token AND tells us the address is real. An unknown address errors
  // here, which is the only place this function learns that — and it says
  // nothing about it.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
  });

  const otp = link?.properties?.email_otp ?? '';

  if (linkError || !otp) {
    // Almost always "no account for this address". Logged without the address:
    // a log full of addresses that tried to reset is itself a list worth
    // stealing, and it would outlive the request that made it.
    console.warn('no recovery code minted', linkError?.message ?? 'no otp returned');
    return ok();
  }

  try {
    await send(email, otp);
  } catch (e) {
    // The token stays minted and unused; it simply expires. The caller is told
    // nothing, and may try again — which is exactly what the rate limit budget
    // is for.
    console.error('reset code send failed', e);
  }

  return ok();
});
