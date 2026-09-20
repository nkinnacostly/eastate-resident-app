// Drains the pgmq `emails` queue and sends via Resend.
//
// Twin of dispatch-notifications, and it inherits that function's hard-won
// retry semantics: Resend, like Expo, can answer with a status that looks like
// success while nothing was delivered, and a naive "archive after POST" throws
// away mail that never went out.
//
// Delivery is AT-LEAST-ONCE, made effectively exactly-once by Resend's
// Idempotency-Key. A retry after a lost response carries the same key and
// Resend returns the original result instead of sending twice. Without it a
// dropped ack means the landlord gets their house code again, which reads as
// the platform malfunctioning.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
  estateAdminWelcome,
  guardWelcome,
  landlordWelcome,
  type RenderedEmail,
} from '../_shared/email-templates.ts';

const RESEND_URL = 'https://api.resend.com/emails';

const BATCH = 25;
const VISIBILITY_SECONDS = 60;

/**
 * Roughly six hours at a one-minute tick.
 *
 * Long enough to outlive the thing that actually causes a stall here — an
 * unverified sending domain, which is fixed by a human editing DNS — and short
 * enough that the queue cannot grow without bound if nobody ever does.
 */
const MAX_ATTEMPTS = 360;

/**
 * Resend responses worth trying again.
 *
 * The test is not "was it an error" but "could a later attempt succeed without
 * this message changing" — the same distinction that decides InvalidCredentials
 * in the push dispatcher, and it is easy to get wrong in the same way.
 *
 *   401 — bad or missing API key.
 *   403 — the sending domain is not verified. THIS is the state this project is
 *         in until the DNS records are published, and it is fixed by a human
 *         editing DNS, not by the message being different. Dropping it would
 *         mean the first estate onboarded before the domain was verified never
 *         gets its welcome email, and nobody would ever know.
 *   429 — rate limited.
 *   5xx — Resend is having a bad day.
 *
 * A 422 validation error is deliberately absent: a malformed recipient fails
 * identically forever, and retrying it blocks the queue behind a message that
 * can never leave it.
 */
const RETRYABLE_STATUS = new Set([401, 403, 429, 500, 502, 503, 504]);

interface QueueMessage {
  msg_id: number;
  read_ct: number;
  message: Record<string, unknown>;
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? 'hello@myestateaccess.com';
/** The visible sender. A bare address reads as machinery; a name reads as a product. */
const FROM = `myestateaccess <${FROM_EMAIL}>`;
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.myestateaccess.com';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://myestateaccess.com';

/** Turn one queue message into a rendered email, or null if we do not know the kind. */
function render(msg: Record<string, unknown>): { to: string; email: RenderedEmail; key: string } | null {
  const kind = msg.kind as string;
  const to = (msg.to as string | undefined)?.trim();
  if (!to) {
    console.warn('email message has no recipient, dropping', kind);
    return null;
  }

  if (kind === 'estate_admin_welcome') {
    return {
      to,
      key: `estate-admin-${msg.estate_id}`,
      email: estateAdminWelcome({
        adminName: (msg.admin_name as string | null) ?? null,
        estateName: (msg.estate_name as string) ?? 'Your estate',
        estateJoinCode: (msg.estate_join_code as string) ?? '',
        dashboardUrl: APP_URL,
        setPasswordUrl: (msg.set_password_url as string | null) ?? null,
      }),
    };
  }

  if (kind === 'landlord_welcome') {
    return {
      to,
      key: `landlord-${msg.house_id}`,
      email: landlordWelcome({
        landlordName: (msg.landlord_name as string | null) ?? null,
        estateName: (msg.estate_name as string) ?? 'Your estate',
        houseNumber: (msg.house_number as string) ?? '',
        houseCode: (msg.house_code as string) ?? '',
        appUrl: SITE_URL,
      }),
    };
  }

  if (kind === 'guard_welcome') {
    return {
      to,
      // Keyed on the pairing, not the person: the same guard registered at a
      // second estate is a different mail and must not be deduplicated away.
      key: `guard-${msg.guard_user_id}-${msg.estate_id}`,
      email: guardWelcome({
        guardName: (msg.guard_name as string | null) ?? null,
        estateName: (msg.estate_name as string | null) ?? null,
        setPasswordUrl: (msg.set_password_url as string | null) ?? null,
      }),
    };
  }

  console.warn('unknown email kind, archiving', kind);
  return null;
}

interface SendResult {
  sent: boolean;
  retryable: boolean;
  detail?: string;
}

async function send(to: string, email: RenderedEmail, key: string): Promise<SendResult> {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      // Scoped per message so a retry of THIS message dedupes, while a genuinely
      // new email to the same person does not get swallowed.
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: email.subject,
      html: email.html,
      // Always both parts. An HTML-only message is a strong spam signal and
      // renders as nothing at all in a text-only client.
      text: email.text,
      reply_to: FROM_EMAIL,
    }),
  });

  if (res.ok) return { sent: true, retryable: false };

  const detail = await res.text();
  return { sent: false, retryable: RETRYABLE_STATUS.has(res.status), detail: `${res.status} ${detail}` };
}

Deno.serve(async () => {
  if (!RESEND_API_KEY) {
    // Leave the queue untouched. Mail waits for the secret rather than being
    // consumed and lost while it is missing.
    console.error('RESEND_API_KEY not set — leaving queue intact');
    return new Response(JSON.stringify({ error: 'resend_key_missing' }), { status: 500 });
  }

  const { data: claimed, error } = await admin.rpc('emails_read', {
    p_qty: BATCH,
    p_vt: VISIBILITY_SECONDS,
  });

  if (error) {
    console.error('emails_read failed', error);
    return new Response(JSON.stringify({ error: 'queue_read_failed' }), { status: 500 });
  }

  const messages = (claimed ?? []) as QueueMessage[];
  let sent = 0;
  let archived = 0;
  let retried = 0;
  let abandoned = 0;

  for (const m of messages) {
    try {
      const r = render(m.message);

      // Unknown kind or no recipient: archive rather than redeliver forever.
      // Neither will be understood on the next attempt either.
      if (r) {
        const result = await send(r.to, r.email, r.key);
        if (result.sent) {
          sent += 1;
        } else if (result.retryable && m.read_ct < MAX_ATTEMPTS) {
          retried += 1;
          console.warn('resend failed, leaving queued', m.msg_id, 'attempt', m.read_ct, result.detail);
          continue;
        } else {
          // Permanent, or out of attempts. Archive so one bad address cannot
          // block every message behind it.
          abandoned += 1;
          console.error('giving up on email', m.msg_id, result.detail);
        }
      }

      await admin.rpc('emails_archive', { p_msg_id: m.msg_id });
      archived += 1;
    } catch (e) {
      // Leave it queued; the visibility timeout lapses and the next tick retries.
      console.error('email dispatch threw for msg', m.msg_id, e);
    }
  }

  return new Response(JSON.stringify({ claimed: messages.length, sent, archived, retried, abandoned }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
