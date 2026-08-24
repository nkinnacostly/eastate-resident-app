-- Estate Access Platform — notification dispatch schedule
-- Technical Design §6.3: Supabase Cron → Edge Function → Expo.
--
-- The queue has had a producer since day one and no consumer. This is the
-- clock that drives the consumer.
--
-- Why cron → Edge Function rather than doing it all in plpgsql: sending to
-- Expo means an outbound HTTPS call with a JSON body and a response worth
-- reading. pg_net can post, but its responses land asynchronously in
-- net._http_response, so error handling becomes a second scheduled job that
-- reconciles tickets. The Edge Function gets to await the response and decide,
-- in one place, whether the message may be archived.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─── Credentials ──────────────────────────────────────────────────────────────
--
-- The service role key bypasses RLS entirely, so it must never appear in a
-- migration — these files are tracked. Vault holds it; this function reads it
-- at call time. The secrets themselves are created out of band (see the README
-- note in this migration's commit message and scripts/, never in SQL that is
-- committed).
--
-- Named lookups, so a rotated key needs no schema change.

create function public.dispatch_notifications_tick()
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

  -- Missing secrets must not raise. This runs on a schedule; a raise here
  -- would fill the cron log with identical failures and tell nobody. A
  -- warning is visible in the logs and leaves the queue intact — messages
  -- keep accumulating and go out once the secrets are in place.
  if v_url is null or v_key is null then
    raise warning 'dispatch_notifications_tick: vault secrets project_url / service_role_key not set';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/dispatch-notifications',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      -- The Edge Function verifies the JWT. The service role key IS a valid
      -- JWT, so this authenticates without disabling verification on the
      -- function — which would leave it open to the whole internet.
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke execute on function public.dispatch_notifications_tick() from public, anon, authenticated;

-- ─── Schedule ─────────────────────────────────────────────────────────────────
--
-- Every minute — the finest granularity pg_cron offers, and the right one
-- here. "A guard is on duty" and "your visitor has arrived" are both worth
-- knowing promptly; a resident standing at a window waiting for a delivery
-- does not want a five-minute lag.
--
-- Unscheduling first makes this migration re-runnable: cron.schedule on an
-- existing name updates it, but being explicit survives a rename.

do $$
begin
  perform cron.unschedule('dispatch-notifications');
exception
  when others then null;  -- not scheduled yet
end;
$$;

select cron.schedule(
  'dispatch-notifications',
  '* * * * *',
  $$select public.dispatch_notifications_tick()$$
);
