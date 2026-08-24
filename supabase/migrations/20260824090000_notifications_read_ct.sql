-- Estate Access Platform — expose delivery attempt count to the dispatcher
--
-- WHY THIS EXISTS
--
-- Expo's push API answers 200 OK and reports per-message failures as "tickets"
-- inside the body. The dispatcher only checked the HTTP status, so a response
-- in which every ticket failed still looked like success and the message was
-- archived — consumed, undelivered, unrecoverable.
--
-- That is not a theoretical path. With no FCM V1 service account key on the
-- EAS project, EVERY ticket comes back `InvalidCredentials`, so the first
-- shift-start notification after a guard signs on would be silently thrown
-- away, and uploading the key later would not bring it back.
--
-- The fix belongs in the Edge Function (see index.ts), but it needs one fact
-- Postgres has and was not handing over: how many times this message has
-- already been delivered. Without it, "retry a credential failure" becomes
-- "retry forever" — an InvalidCredentials on an abandoned project would spin
-- once a minute until someone noticed.
--
-- pgmq tracks this as `read_ct` on the message record. The original wrapper
-- projected only (msg_id, message) and dropped it.

-- The return type changes, so this is a drop-and-recreate rather than a
-- CREATE OR REPLACE (Postgres refuses to replace a function whose OUT columns
-- differ). Dropping is safe: the only caller is the dispatcher, which is
-- redeployed alongside this migration.
drop function if exists public.notifications_read(integer, integer);

create function public.notifications_read(p_qty integer, p_vt integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql
volatile
security definer
set search_path = ''
as $$
  select r.msg_id, r.read_ct, r.message
    from pgmq.read('notifications', p_vt, p_qty) as r;
$$;

-- EXECUTE is granted to PUBLIC by default, so the revoke is what actually
-- makes this service-role-only. Draining the notification queue means reading
-- every resident's pending notifications; re-granting after a recreate is not
-- optional. See CLAUDE.md — this was a real bug in this project before.
revoke execute on function public.notifications_read(integer, integer) from public, anon, authenticated;
grant  execute on function public.notifications_read(integer, integer) to service_role;
