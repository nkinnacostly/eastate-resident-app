-- Invariants for apply_retention(). Each one states what must be TRUE after a
-- sweep; a failure raises, so the script exits non-zero.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end $$;

-- ─── Seed ────────────────────────────────────────────────────────────────────

insert into public.estates (id, name, event_retention_days) values
  ('e0000000-0000-4000-8000-000000000001', 'Default 90d', 90),
  ('e0000000-0000-4000-8000-000000000002', 'Risk-justified 180d', 180);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');

insert into public.profiles (id, full_name) values
  ('00000000-0000-4000-8000-000000000001', 'Ada Guard'),
  ('00000000-0000-4000-8000-000000000002', 'Bode Resident');

insert into public.memberships (id, user_id, estate_id, role, unit) values
  ('11111111-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'guard', null),
  ('11111111-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   'e0000000-0000-4000-8000-000000000001', 'resident', 'H4'),
  ('11111111-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000002', 'guard', null);

-- Codes: one fresh, one old-and-referenced-by-a-flag, one old-and-orphaned,
-- one old at the 180-day estate (must survive its shorter-window sibling).
insert into public.access_codes (id, code, estate_id, membership_id, created_at, expires_at) values
  ('c0000000-0000-4000-8000-00000000000f', 'FRESH1', 'e0000000-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000002', now() - interval '1 day',   now() + interval '5 hours'),
  ('c0000000-0000-4000-8000-000000000001', 'OLDFLG', 'e0000000-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000002', now() - interval '200 days', now() - interval '200 days'),
  ('c0000000-0000-4000-8000-000000000002', 'ORPHAN', 'e0000000-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000002', now() - interval '200 days', now() - interval '200 days'),
  ('c0000000-0000-4000-8000-000000000003', 'LONGWD', 'e0000000-0000-4000-8000-000000000002',
   '11111111-0000-4000-8000-000000000002', now() - interval '120 days', now() - interval '120 days');

insert into public.verification_events
  (id, client_event_id, estate_id, code_id, code_attempted, verified_by_membership_id,
   verified_at, synced_at, source, outcome, admitted_without_match)
values
  -- fresh: untouched
  ('d0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-00000000000f', 'FRESH1', '11111111-0000-4000-8000-000000000001',
   now(), now() - interval '1 day', 'online', 'admitted', false),
  -- ordinary, 200 days: cleared
  ('d0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
   null, 'GONE01', '11111111-0000-4000-8000-000000000001',
   now() - interval '200 days', now() - interval '200 days', 'online', 'rejected', false),
  -- flagged, 200 days: KEPT (incident record, 3-year clock)
  ('d0000000-0000-4000-8000-000000000003', gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001', 'OLDFLG', '11111111-0000-4000-8000-000000000001',
   now() - interval '200 days', now() - interval '200 days', 'offline_replay', 'admitted', true),
  -- flagged, 4 years: cleared
  ('d0000000-0000-4000-8000-000000000004', gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
   null, 'OLDFLG2', '11111111-0000-4000-8000-000000000001',
   now() - interval '4 years', now() - interval '4 years', 'offline_replay', 'admitted', true),
  -- ordinary, 120 days, at the 180-day estate: KEPT
  ('d0000000-0000-4000-8000-000000000005', gen_random_uuid(), 'e0000000-0000-4000-8000-000000000002',
   'c0000000-0000-4000-8000-000000000003', 'LONGWD', '11111111-0000-4000-8000-000000000003',
   now() - interval '120 days', now() - interval '120 days', 'online', 'admitted', false);

insert into public.guard_shifts (id, estate_id, membership_id, started_at, ended_at) values
  ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001', now() - interval '200 days', now() - interval '200 days'),
  ('f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001', now() - interval '5 years', now() - interval '5 years');

-- ─── Sweep ───────────────────────────────────────────────────────────────────

select * from public.apply_retention() \gset sweep_

-- ─── Assertions ──────────────────────────────────────────────────────────────

-- 1. A gate event past its window keeps its shape and loses its people.
select pg_temp.check('ordinary event past window is de-identified', (
  select verified_by_membership_id is null
     and code_attempted is null
     and code_id is null
     and de_identified_at is not null
     -- the register survives: estate, time, outcome all intact
     and estate_id is not null and outcome = 'rejected' and synced_at is not null
  from public.verification_events where id = 'd0000000-0000-4000-8000-000000000002'));

-- 2. Fresh events are not touched.
select pg_temp.check('fresh event untouched', (
  select verified_by_membership_id is not null and code_attempted = 'FRESH1'
     and de_identified_at is null
  from public.verification_events where id = 'd0000000-0000-4000-8000-000000000001'));

-- 3. A flagged entry is an incident report: 200 days is NOT enough to clear it.
--    This is the one that protects the record of who overrode a refusal.
select pg_temp.check('flagged entry survives the 90-day window', (
  select verified_by_membership_id is not null and code_attempted = 'OLDFLG'
     and de_identified_at is null
  from public.verification_events where id = 'd0000000-0000-4000-8000-000000000003'));

-- 4. ...but three years does clear it.
select pg_temp.check('flagged entry clears at three years', (
  select verified_by_membership_id is null and de_identified_at is not null
  from public.verification_events where id = 'd0000000-0000-4000-8000-000000000004'));

-- 5. The per-estate window is honoured, not a global constant.
select pg_temp.check('180-day estate keeps a 120-day event', (
  select verified_by_membership_id is not null and de_identified_at is null
  from public.verification_events where id = 'd0000000-0000-4000-8000-000000000005'));

-- 6. An orphaned old code is deleted outright.
select pg_temp.check('orphaned old code deleted', (
  select count(*) = 0 from public.access_codes
   where id = 'c0000000-0000-4000-8000-000000000002'));

-- 7. A code still referenced by a live flagged entry MUST survive, or the
--    incident report loses the very evidence it exists to hold.
select pg_temp.check('code referenced by a flagged entry survives', (
  select count(*) = 1 from public.access_codes
   where id = 'c0000000-0000-4000-8000-000000000001'));

-- 8. Fresh codes untouched.
select pg_temp.check('fresh code untouched', (
  select count(*) = 1 from public.access_codes
   where id = 'c0000000-0000-4000-8000-00000000000f'));

-- 9. Shifts are kept four years, past the 90-day window for visitor data.
select pg_temp.check('200-day shift survives (4-year floor)', (
  select membership_id is not null and de_identified_at is null
  from public.guard_shifts where id = 'f0000000-0000-4000-8000-000000000001'));

select pg_temp.check('5-year shift is de-identified', (
  select membership_id is null and de_identified_at is not null
  from public.guard_shifts where id = 'f0000000-0000-4000-8000-000000000002'));

-- 10. Idempotent: a second nightly run must be a no-op, not a rewrite of
--     de_identified_at (which would destroy the evidence of WHEN it ran).
select de_identified_at as first_run from public.verification_events
 where id = 'd0000000-0000-4000-8000-000000000002' \gset
select * from public.apply_retention() \gset second_
select pg_temp.check('second sweep clears nothing new', :'second_events_cleared'::int = 0);
select pg_temp.check('de_identified_at is not rewritten', (
  select de_identified_at = :'first_run'::timestamptz
  from public.verification_events where id = 'd0000000-0000-4000-8000-000000000002'));

-- 11. The window cannot be set to "forever".
do $$
begin
  update public.estates set event_retention_days = 3650
   where id = 'e0000000-0000-4000-8000-000000000001';
  raise exception 'FAIL  retention window accepted 3650 days';
exception
  when check_violation then raise notice 'PASS  retention window rejects 3650 days';
end $$;

do $$
begin
  update public.estates set event_retention_days = 1
   where id = 'e0000000-0000-4000-8000-000000000001';
  raise exception 'FAIL  retention window accepted 1 day';
exception
  when check_violation then raise notice 'PASS  retention window rejects 1 day';
end $$;

-- 12. No row is ever deleted from the register.
select pg_temp.check('every seeded event still exists', (
  select count(*) = 5 from public.verification_events));

-- 13. The four-year reason is stated without a regulator's name (20261030120000),
-- and replacing the function kept it out of every client role's reach.
select pg_temp.check('apply_retention names no regulator', (
  select prosrc not ilike '%psira%' and prosrc like '%account for who was%'
    from pg_proc where oid = 'public.apply_retention()'::regprocedure));
select pg_temp.check('apply_retention is still not callable by anon or authenticated', (
  not has_function_privilege('anon', 'public.apply_retention()', 'execute')
  and not has_function_privilege('authenticated', 'public.apply_retention()', 'execute')));

-- 14. The retention reasoning rests on Nigeria's Data Protection Act, not on
-- South Africa's draft gated-access code or POPIA (20261030130000).
select pg_temp.check('apply_retention''s comments cite the NDPA, not SA law', (
  select prosrc ilike '%NDPA%'
     and prosrc not ilike '%draft code%' and prosrc not ilike '%popia%'
     and prosrc not ilike '%regulator has%'
    from pg_proc where oid = 'public.apply_retention()'::regprocedure));
select pg_temp.check('the retention window''s description cites the NDPA', (
  select d ilike '%NDPA%' and d not ilike '%SA draft%' and d ilike '%keep forever%'
    from (select col_description('public.estates'::regclass,
                 (select attnum from pg_attribute
                   where attrelid = 'public.estates'::regclass
                     and attname = 'event_retention_days')) as d) x));
