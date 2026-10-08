// Drains the pgmq `emails` queue and sends via MyDomainsHub Mail
// (_shared/mailer.ts).
//
// Twin of dispatch-notifications, and it inherits that function's hard-won
// retry semantics: a provider can answer with a status that looks like success
// while nothing was delivered, and a naive "archive after POST" throws away
// mail that never went out. The 200 here means QUEUED on their side, not
// delivered — a bounce after that is theirs to report, not ours to retry.
//
// Delivery is AT-LEAST-ONCE, made effectively exactly-once by the provider's
// Idempotency-Key. A retry after a lost response carries the same key and the
// provider returns the original result instead of sending twice. Without it a
// dropped ack means the landlord gets their house code again, which reads as
// the platform malfunctioning.

import { formatMoney } from '../_shared/money.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
  estateAdminWelcome,
  guardWelcome,
  guardInvite,
  settlementChanged,
  duesReminder,
  landlordWelcome,
  type RenderedEmail,
} from '../_shared/email-templates.ts';
import { MAIL_API_KEY, sendEmail } from '../_shared/mailer.ts';
import { forbidden, isServiceRole } from '../_shared/caller.ts';

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
        dashboardUrl: APP_URL,
      }),
    };
  }

  if (kind === 'settlement_changed') {
    return {
      to,
      // Per change and per recipient: every admin hears about every change.
      key: `settlement-${msg.estate_id}-${msg.subaccount_ref}-${to}`,
      email: settlementChanged({
        estateName: (msg.estate_name as string) ?? 'Your estate',
        bankName: (msg.bank_name as string | null) ?? null,
        accountLast4: (msg.account_last4 as string) ?? '????',
        accountName: (msg.account_name as string) ?? '',
        changedBy: (msg.changed_by as string) ?? 'an estate admin',
        changedAt: (msg.changed_at as string) ?? '',
      }),
    };
  }

  if (kind === 'guard_invite') {
    return {
      to,
      // One mail per invitation: asking the same person again reuses the
      // invitation, and within the provider's 24 hours this key keeps it from
      // landing in their inbox twice.
      key: `guard-invite-${msg.invite_id}`,
      email: guardInvite({ estateName: (msg.estate_name as string | null) ?? null }),
    };
  }

  if (kind === 'dues_reminder') {
    const minor = Number(msg.amount_minor ?? 0);
    const currency = (msg.currency as string) ?? 'NGN';
    const dueOn = (msg.due_on as string) ?? '';
    const role = (msg.recipient_role as 'landlord' | 'resident') ?? 'resident';
    const token = (msg.pay_token as string | null) ?? null;

    // Days left is computed HERE rather than carried on the message, because a
    // message can sit in the queue through a retry and "due in 7 days" written
    // yesterday is wrong today.
    const due = new Date(`${dueOn}T00:00:00Z`);
    const daysLeft = Number.isNaN(due.getTime())
      ? 0
      : Math.round((due.getTime() - Date.now()) / 86_400_000);

    return {
      to,
      // Keyed on charge + kind + address: the same charge legitimately mails a
      // landlord and a tenant, and both reminders for one charge are distinct.
      key: `dues-${msg.charge_id}-${msg.reminder_kind}-${to}`,
      email: duesReminder({
        recipientName: (msg.recipient_name as string | null) ?? null,
        role,
        landlordPays: Boolean(msg.house_number),
        estateName: (msg.estate_name as string) ?? 'Your estate',
        houseNumber: (msg.house_number as string | null) ?? null,
        amount: formatMoney(minor, currency),
        dueOn: due.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          timeZone: 'UTC',
        }),
        daysLeft,
        payUrl: token ? `${SITE_URL}/dues/pay?t=${encodeURIComponent(token)}` : null,
        appUrl: SITE_URL,
        // Absent on reminders queued before the flag existed: those say nothing
        // about paused codes rather than risk threatening one that is not real.
        codesPause: msg.codes_pause === true,
      }),
    };
  }

  console.warn('unknown email kind, archiving', kind);
  return null;
}

Deno.serve(async (req) => {
  // Cron only. The anon key passes the gateway; see _shared/caller.ts.
  if (!isServiceRole(req)) return forbidden();

  if (!MAIL_API_KEY) {
    // Leave the queue untouched. Mail waits for the secret rather than being
    // consumed and lost while it is missing.
    console.error('DOMAINHUB_API_KEY not set — leaving queue intact');
    return new Response(JSON.stringify({ error: 'email_key_missing' }), { status: 500 });
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
        // Keyed per message so a retry of THIS message dedupes, while a
        // genuinely new email to the same person does not get swallowed.
        const result = await sendEmail(r.to, r.email, { idempotencyKey: r.key });
        if (result.sent) {
          sent += 1;
        } else if (result.retryable && m.read_ct < MAX_ATTEMPTS) {
          retried += 1;
          console.warn('send failed, leaving queued', m.msg_id, 'attempt', m.read_ct, result.detail);
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
