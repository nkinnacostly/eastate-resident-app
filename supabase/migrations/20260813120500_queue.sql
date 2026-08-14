-- Estate Access Platform — notification queue
-- Technical Design v2.0 §2.7, §6.3
--
-- Replaces a hand-rolled outbox table. pgmq already provides the
-- claim / visibility-timeout / archive machinery that table was reimplementing,
-- and pgmq.send() is a SQL function — so the intent to notify still commits in
-- the SAME TRANSACTION as the burn. That transactional property is the entire
-- reason an outbox existed; pgmq keeps it.

create extension if not exists pgmq;

-- pgmq.create() is not idempotent across re-runs, so guard it.
do $$
begin
  perform pgmq.create('notifications');
exception
  when duplicate_table or unique_violation then null;
end;
$$;

-- Messages are shaped:
--   { "kind": "code_used",   "membership_id": <resident>, "code": "...",
--     "verified_at": "..." }
--   { "kind": "forced_pull", "membership_id": <guard> }
--
-- Consumed by the `dispatch-notifications` Edge Function on a Cron schedule:
-- pgmq.read with a visibility timeout -> send via Expo -> pgmq.archive.
-- A message whose visibility expires before it is archived becomes visible
-- again: at-least-once, which is what we want. A resident may occasionally get
-- a duplicate notification; dedupe client-side on the event id if it shows up.

-- No client ever touches the queue.
revoke all on schema pgmq from anon, authenticated;
