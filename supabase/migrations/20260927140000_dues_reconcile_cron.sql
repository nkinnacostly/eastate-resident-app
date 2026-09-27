-- Estate Access Platform — the dues reconciliation tick
--
-- Flutterwave's webhook is not a guarantee. Their retries are three attempts at
-- 30-minute intervals, and RETRIES ARE OFF BY DEFAULT until switched on in the
-- dashboard -- so a 90-minute outage, or a dashboard setting nobody checked,
-- loses a payment silently. Their own guidance is to poll: "we recommend
-- setting up a background job that polls for the status of any pending
-- transactions at regular intervals."
--
-- Without this, the first anyone learns of a lost payment is a resident who
-- paid, is still locked out, and is standing at the gate.
--
-- Follows dispatch_notifications_tick exactly: pg_net posting to an Edge
-- Function with the service role key as the bearer, so the function keeps its
-- JWT gate rather than being opened to the internet.

create function public.dues_reconcile_tick()
returns void
language plpgsql
volatile
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

  -- A warning, never a raise. This runs on a schedule, and a raise would fill
  -- the cron log with identical failures while telling nobody. Nothing is lost
  -- by skipping a tick: the payments stay pending and the next run picks them
  -- up.
  if v_url is null or v_key is null then
    raise warning 'dues_reconcile_tick: vault secrets project_url / service_role_key not set';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/dues-reconcile',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb,
    -- Longer than the notification tick: this makes one outbound verify call to
    -- Flutterwave per pending payment, and their system waits 28 seconds before
    -- returning a timeout of its own.
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function public.dues_reconcile_tick() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('dues-reconcile');
exception when others then null;
end;
$$;

-- Every ten minutes, not every minute. The function only looks at payments
-- already ten minutes old, so a faster tick would re-examine the same rows and
-- spend Flutterwave's rate limit to learn nothing. Ten minutes is also well
-- inside their 30-minute retry interval, so in the ordinary case this finds
-- the payment before their second attempt.
select cron.schedule(
  'dues-reconcile',
  '*/10 * * * *',
  $$select public.dues_reconcile_tick()$$
);
