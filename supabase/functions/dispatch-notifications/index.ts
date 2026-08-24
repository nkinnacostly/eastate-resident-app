// Drains the pgmq `notifications` queue and sends the messages via Expo Push.
//
// This is the consumer the queue was always written for (see queue.sql) and
// never had. Until now `code_used` messages piled up unread and nothing ever
// reached a device — the plumbing existed, the tap did not.
//
// Invoked on a Cron schedule, not by a client. It uses the service role, which
// bypasses RLS entirely and therefore never leaves this function.
//
// Delivery is AT-LEAST-ONCE by design. A message is archived only after Expo
// has accepted it; if this function dies in between, the visibility timeout
// lapses and the message is redelivered. A duplicate notification is a far
// smaller problem than a resident never being told, so the failure is
// deliberately pointed that way.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** How many queue messages to claim per run. */
const BATCH = 50;

/**
 * Seconds a claimed message stays invisible to other readers.
 *
 * Must comfortably exceed the worst-case time to call Expo and archive, or a
 * slow run redelivers work it is still doing and sends twice.
 */
const VISIBILITY_SECONDS = 60;

/** Expo rejects requests over 100 messages. */
const EXPO_CHUNK = 100;

/**
 * How many delivery attempts a message gets before it is archived undelivered.
 *
 * Bounds the retry of a fault that never clears on its own — an FCM key that
 * is never uploaded, say. At a one-minute cron that is roughly six hours of
 * trying, which comfortably outlives a credential fix or an Expo outage while
 * still guaranteeing the queue drains.
 */
const MAX_ATTEMPTS = 360;

/**
 * Expo ticket errors that are worth trying again.
 *
 * The distinction is whether a later attempt could plausibly succeed:
 *
 *   InvalidCredentials  — the project's FCM key is missing or wrong. Fixed by
 *                         a human, and the moment it is, the queued message
 *                         should go out. Retryable.
 *   MessageRateExceeded — Expo is throttling us. Retryable by definition.
 *   ProviderError       — FCM itself failed. Transient.
 *
 * Everything else is permanent for this message: DeviceNotRegistered means the
 * app was uninstalled, MessageTooBig means the payload will be just as big
 * next time. Those are logged and dropped — retrying them never succeeds and
 * would block the queue behind a message that can never leave it.
 */
const RETRYABLE_TICKET_ERRORS = new Set([
  'InvalidCredentials',
  'MessageRateExceeded',
  'ProviderError',
]);

interface QueueMessage {
  msg_id: number;
  read_ct: number;
  message: Record<string, unknown>;
}

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound?: 'default';
  /**
   * Android notification channel to deliver on.
   *
   * Android 8+ takes importance, sound and vibration from the CHANNEL, not the
   * message — so omitting this is not a cosmetic default, it changes
   * behaviour. Without it FCM drops the message onto
   * `fcm_fallback_notification_channel`, which the app never declared and the
   * user cannot meaningfully manage.
   *
   * For the guard that is a real defect rather than untidiness: `forced_pull`
   * is a silent sync wake-up, and the fallback channel rings and vibrates at
   * default importance. Routing it to the app's MIN-importance `sync` channel
   * is what actually keeps it quiet.
   *
   * The named channel must exist on the device or Android drops the message,
   * so these must match the channels created in each app's registerForPush().
   */
  channelId?: string;
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

/** Every active push token for one membership. A person may have several devices. */
async function tokensForMembership(membershipId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('push_tokens')
    .select('expo_push_token')
    .eq('membership_id', membershipId);
  if (error) throw error;
  return (data ?? []).map((r) => r.expo_push_token as string);
}

/**
 * Every active resident token at an estate — the shift-start fan-out.
 *
 * Done here rather than in Postgres on purpose: `start_shift` enqueues ONE
 * message for the estate, so the fan-out cost is paid once per shift by this
 * function instead of putting a queue row per household inside the guard's
 * transaction.
 */
async function residentTokensForEstate(estateId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('push_tokens')
    .select('expo_push_token, memberships!inner(estate_id, role, is_active)')
    .eq('memberships.estate_id', estateId)
    .eq('memberships.role', 'resident')
    .eq('memberships.is_active', true);
  if (error) throw error;
  return (data ?? []).map((r) => r.expo_push_token as string);
}

/** Turns one queue message into zero or more push messages. */
async function toPushMessages(msg: Record<string, unknown>): Promise<PushMessage[]> {
  const kind = msg.kind as string;

  if (kind === 'shift_started') {
    const tokens = await residentTokensForEstate(msg.estate_id as string);
    const guard = (msg.guard_name as string) || 'A guard';
    return tokens.map((to) => ({
      to,
      title: `${guard} is on duty`,
      body: `${guard} has started their shift and is ready to receive your visitors.`,
      data: { kind, shiftId: msg.shift_id, startedAt: msg.started_at },
      sound: 'default',
      // Matches the channel the resident app creates on registration.
      channelId: 'default',
    }));
  }

  if (kind === 'code_used') {
    const tokens = await tokensForMembership(msg.membership_id as string);
    return tokens.map((to) => ({
      to,
      title: 'Your visitor has arrived',
      body: `Code ${msg.code} was used at the gate.`,
      data: { kind, code: msg.code, verifiedAt: msg.verified_at },
      sound: 'default',
      channelId: 'default',
    }));
  }

  if (kind === 'forced_pull') {
    // Data-only: this wakes a guard's device to re-pull its offline pool. It
    // must not surface as a banner — the guard is watching a gate, not a phone.
    const tokens = await tokensForMembership(msg.membership_id as string);
    // Empty title/body keeps this data-only so no banner is built, and the
    // MIN-importance `sync` channel makes sure that if the OS does surface
    // anything it does so silently. The guard app creates this channel.
    return tokens.map((to) => ({ to, title: '', body: '', data: { kind }, channelId: 'sync' }));
  }

  // Unknown kind. Archive it rather than redelivering forever — a message this
  // build does not understand will not be understood on the next attempt
  // either, and leaving it would block nothing but would grow without bound.
  console.warn('unknown notification kind, archiving', kind);
  return [];
}

/**
 * Push one queue message's worth of notifications.
 *
 * Returns whether the message may be archived. A 200 from Expo is NOT proof of
 * delivery — Expo reports per-message failures as tickets inside a 200 body,
 * so reading only the HTTP status treats a wholly failed send as a success and
 * archives work that never went out.
 *
 * The rule: keep the message on the queue only if NOTHING got through and the
 * reason might clear. If even one token was accepted, archiving is right —
 * redelivering would re-notify everyone who already got it to chase the one
 * who did not.
 */
async function sendToExpo(messages: PushMessage[]): Promise<{ retryable: boolean }> {
  let accepted = 0;
  let retryableErrors = 0;
  let permanentErrors = 0;

  for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_CHUNK);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      // A transport-level failure says nothing about the individual messages,
      // so throw and let the caller leave the whole thing queued.
      throw new Error(`expo push failed: ${res.status} ${await res.text()}`);
    }

    const body = await res.json();
    for (const ticket of body?.data ?? []) {
      if (ticket?.status !== 'error') {
        accepted += 1;
        continue;
      }
      const code = ticket?.details?.error as string | undefined;
      if (code && RETRYABLE_TICKET_ERRORS.has(code)) {
        retryableErrors += 1;
      } else {
        // DeviceNotRegistered lands here: the app was uninstalled, so the
        // token is dead and reaping it is a separate job.
        permanentErrors += 1;
      }
      console.warn('expo ticket error', code, ticket?.message);
    }
  }

  return { retryable: accepted === 0 && retryableErrors > 0 && permanentErrors === 0 };
}

Deno.serve(async () => {
  // Via public wrappers, not pgmq directly: PostgREST only exposes `public`
  // and `graphql_public`, and the pgmq schema is deliberately revoked from
  // every client role. See the wrappers in the guard_shifts migration.
  const { data: claimed, error } = await admin.rpc('notifications_read', {
    p_qty: BATCH,
    p_vt: VISIBILITY_SECONDS,
  });

  if (error) {
    console.error('pgmq read failed', error);
    return new Response(JSON.stringify({ error: 'queue_read_failed' }), { status: 500 });
  }

  const messages = (claimed ?? []) as QueueMessage[];
  let sent = 0;
  let archived = 0;
  let retried = 0;
  let abandoned = 0;

  for (const m of messages) {
    try {
      const push = await toPushMessages(m.message);
      let retryable = false;
      if (push.length > 0) {
        ({ retryable } = await sendToExpo(push));
        sent += push.length;
      }

      // Nothing reached a device and the cause might clear — leave the message
      // claimed-but-unarchived so the visibility timeout lapses and the next
      // tick tries again. This is the path an unconfigured FCM key takes: the
      // notification waits rather than evaporating, and goes out on its own
      // once the key is uploaded.
      if (retryable && m.read_ct < MAX_ATTEMPTS) {
        retried += 1;
        console.warn('undelivered, leaving queued', m.msg_id, 'attempt', m.read_ct);
        continue;
      }
      if (retryable) {
        // Out of attempts. Archiving loses it, but a message that has failed
        // every minute for hours is not one more attempt away from working,
        // and an unbounded queue is its own outage.
        abandoned += 1;
        console.error('giving up after', m.read_ct, 'attempts, archiving', m.msg_id);
      }

      // Archive only after Expo accepted it. Reversing these two lines turns
      // at-least-once into at-most-once and silently loses notifications
      // whenever Expo is briefly unreachable.
      await admin.rpc('notifications_archive', { p_msg_id: m.msg_id });
      archived += 1;
    } catch (e) {
      // Leave it on the queue. Its visibility timeout lapses and the next run
      // retries it.
      console.error('dispatch failed for msg', m.msg_id, e);
    }
  }

  return new Response(
    JSON.stringify({ claimed: messages.length, sent, archived, retried, abandoned }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
