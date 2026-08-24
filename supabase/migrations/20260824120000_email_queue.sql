-- Estate Access Platform — transactional email
--
-- Same shape as the notification queue (§6.3): producer enqueues inside the
-- transaction that caused the event, a Cron-driven Edge Function drains it and
-- talks to the outside world. Nothing sends inline.
--
-- WHY A SEPARATE QUEUE RATHER THAN NEW KINDS ON `notifications`
--
-- Failure domains. The notification dispatcher talks to Expo; this one talks to
-- Resend. Sharing a queue means an Expo outage holds a claimed message with its
-- visibility timeout while a perfectly sendable welcome email sits behind it,
-- and a Resend credential problem stalls "your visitor has arrived". They fail
-- independently, so they queue independently.

select pgmq.create('emails');

-- ─── Producer helper ─────────────────────────────────────────────────────────
--
-- service_role only. Edge Functions enqueue through this; no client ever
-- reaches it. An authenticated caller who could push arbitrary payloads onto
-- this queue could make the platform send mail to any address it likes, with
-- our DKIM signature on it.

create function public.enqueue_email(p_kind text, p_payload jsonb)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
  select pgmq.send('emails', jsonb_build_object('kind', p_kind) || p_payload);
$$;

revoke execute on function public.enqueue_email(text, jsonb) from public, anon, authenticated;
grant  execute on function public.enqueue_email(text, jsonb) to service_role;

-- ─── Consumer helpers ────────────────────────────────────────────────────────
--
-- `read_ct` is projected deliberately: the dispatcher needs it to bound retries
-- of a fault that never clears on its own (an unverified sending domain, say).
-- Leaving it out is what let the notification dispatcher retry forever before
-- it was fixed.

create function public.emails_read(p_qty integer, p_vt integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql
volatile
security definer
set search_path = ''
as $$
  select r.msg_id, r.read_ct, r.message
    from pgmq.read('emails', p_vt, p_qty) as r;
$$;

create function public.emails_archive(p_msg_id bigint)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select pgmq.archive('emails', p_msg_id);
$$;

revoke execute on function public.emails_read(integer, integer) from public, anon, authenticated;
revoke execute on function public.emails_archive(bigint)        from public, anon, authenticated;
grant  execute on function public.emails_read(integer, integer)  to service_role;
grant  execute on function public.emails_archive(bigint)         to service_role;

-- ─── Landlord welcome ────────────────────────────────────────────────────────
--
-- A TRIGGER rather than a line inside create_house, on purpose. create_house is
-- today's only way to register a house, but it is not the only way there could
-- ever be — a backfill, an import, a future bulk-upload RPC. A trigger fires
-- for every insert regardless of who wrote the INSERT, so the email cannot be
-- forgotten by a path added later.
--
-- Fires only when there is somewhere to send it. `landlord_email` is nullable
-- because backfilled houses have no landlord on record (see the houses
-- migration), and a house without one is ordinary, not an error.
--
-- Enqueued in the SAME transaction as the insert: if the house does not commit,
-- no email goes out about a house that does not exist.

create function public.enqueue_landlord_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estate_name text;
begin
  if new.landlord_email is null or btrim(new.landlord_email) = '' then
    return new;
  end if;

  select e.name into v_estate_name
    from public.estates e where e.id = new.estate_id;

  perform pgmq.send('emails', jsonb_build_object(
    'kind',          'landlord_welcome',
    'to',            new.landlord_email,
    'landlord_name', new.landlord_name,
    'estate_name',   coalesce(v_estate_name, 'Your estate'),
    'house_number',  new.house_number,
    'house_code',    new.house_code,
    -- Carried so the dispatcher can build a stable idempotency key. Resend
    -- deduplicates on it for 24 hours, which turns this queue's at-least-once
    -- delivery into exactly-one-email in every retry case that matters.
    'house_id',      new.id
  ));

  return new;
end;
$$;

create trigger houses_enqueue_landlord_welcome
  after insert on public.houses
  for each row
  execute function public.enqueue_landlord_welcome();

-- ─── Schedule ────────────────────────────────────────────────────────────────
--
-- Its own tick, not a branch inside dispatch_notifications_tick. Two jobs mean
-- a failure in one is visible as a failure of that job in cron.job_run_details,
-- rather than one job that half-worked.

create function public.dispatch_emails_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key';

  -- A warning, never an exception. This runs on a schedule; raising would fill
  -- the cron log with identical failures and tell nobody, and would leave the
  -- queue intact anyway.
  if v_url is null or v_key is null then
    raise warning 'dispatch_emails_tick: vault secrets project_url / service_role_key not set';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/send-emails',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke execute on function public.dispatch_emails_tick() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('dispatch-emails');
exception
  when others then null;  -- not scheduled yet
end;
$$;

select cron.schedule(
  'dispatch-emails',
  '* * * * *',
  $$select public.dispatch_emails_tick()$$
);
