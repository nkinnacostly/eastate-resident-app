-- Guard profile for the estate admin: invariants.
--
-- The RPC takes a TARGET membership id from the client, so the tests that
-- matter are the ones where that id points somewhere it should not: another
-- estate's guard, or a resident rather than a guard.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end $$;

-- See supabase/tests/operator-dues.sql: the "nothing raised" failure is raised
-- outside the block that catches it, or it catches itself and passes.
create or replace function pg_temp.raises(label text, sql text, want text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception
    when others then
      if sqlerrm like '%' || want || '%' then
        raise notice 'PASS  % (%)', label, want;
        return;
      end if;
      raise exception 'FAIL  % (wanted %, got %)', label, want, sqlerrm;
  end;
  raise exception 'FAIL  % (expected %, nothing raised)', label, want;
end $$;

-- ─── Seed ────────────────────────────────────────────────────────────────────

insert into auth.users (id, email, last_sign_in_at) values
  ('c7000000-0000-4000-8000-00000000000a', 'admin7@example.com',   now()),
  ('c7000000-0000-4000-8000-00000000000b', 'adminb7@example.com',  now()),
  ('c7000000-0000-4000-8000-000000000001', 'gary.guard@example.com', now() - interval '2 hours'),
  ('c7000000-0000-4000-8000-000000000002', 'other.guard@example.com', null),
  ('c7000000-0000-4000-8000-000000000003', 'resident7@example.com', now());

insert into public.profiles (id, full_name, phone, psira_registration_number, psira_grade,
                             psira_expires_at) values
  ('c7000000-0000-4000-8000-00000000000a', 'Admin A', null, null, null, null),
  ('c7000000-0000-4000-8000-00000000000b', 'Admin B', null, null, null, null),
  ('c7000000-0000-4000-8000-000000000001', 'Gary Guard', '+27820000001', '4455667', 'C',
   now() + interval '200 days'),
  ('c7000000-0000-4000-8000-000000000002', 'Other Guard', null, null, null, null),
  ('c7000000-0000-4000-8000-000000000003', 'Resident Seven', null, null, null, null);

insert into public.agencies (id, name, registration_number, registration_body) values
  ('b7000000-0000-4000-8000-000000000001', 'Gatekeepers Ltd', '1234567', 'ZA-PSIRA');

insert into public.estates (id, name) values
  ('e7000000-0000-4000-8000-000000000001', 'Estate A'),
  ('e7000000-0000-4000-8000-000000000002', 'Estate B');

insert into public.memberships (id, user_id, estate_id, role, placed_by_agency_id) values
  ('a7000000-0000-4000-8000-00000000000a','c7000000-0000-4000-8000-00000000000a','e7000000-0000-4000-8000-000000000001','admin',null),
  ('a7000000-0000-4000-8000-00000000000b','c7000000-0000-4000-8000-00000000000b','e7000000-0000-4000-8000-000000000002','admin',null),
  ('a7000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','e7000000-0000-4000-8000-000000000001','guard','b7000000-0000-4000-8000-000000000001'),
  ('a7000000-0000-4000-8000-000000000002','c7000000-0000-4000-8000-000000000002','e7000000-0000-4000-8000-000000000002','guard',null),
  ('a7000000-0000-4000-8000-000000000003','c7000000-0000-4000-8000-000000000003','e7000000-0000-4000-8000-000000000001','resident',null);

-- Gary: one 8h shift last week, one shift that began 31 days ago and ran 48h
-- (so only ~24h of it is inside the 30-day window), and on duty now for 1h.
insert into public.guard_shifts (estate_id, membership_id, started_at, ended_at, ended_by_handover) values
  ('e7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',
   now() - interval '7 days', now() - interval '7 days' + interval '8 hours', true),
  ('e7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',
   now() - interval '31 days', now() - interval '31 days' + interval '48 hours', false),
  ('e7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',
   now() - interval '1 hour', null, false),
  ('e7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000002',
   now() - interval '1 day', now() - interval '20 hours', false);

-- Gary's gate activity. One event's DEVICE clock says 2019 -- it must still
-- count, because the window is on synced_at.
insert into public.verification_events (client_event_id, estate_id, verified_by_membership_id,
    verified_at, synced_at, source, outcome, reject_reason, admitted_without_match) values
  (gen_random_uuid(),'e7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',
   now(), now(), 'online', 'admitted', null, false),
  (gen_random_uuid(),'e7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',
   '2019-01-01', now(), 'offline_replay', 'admitted', null, true),
  (gen_random_uuid(),'e7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',
   now(), now(), 'online', 'rejected', 'expired', false),
  (gen_random_uuid(),'e7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001',
   now() - interval '40 days', now() - interval '40 days', 'online', 'admitted', null, false);

-- ─── Positive control ────────────────────────────────────────────────────────

set test.uid = 'c7000000-0000-4000-8000-00000000000a';
select count(*) as n from public.estate_guard_profile(
  'e7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001') \gset pc_
select pg_temp.check('the fixture can establish an estate admin who sees their guard', :'pc_n'::int = 1);

-- ─── The profile ─────────────────────────────────────────────────────────────

select * from public.estate_guard_profile(
  'e7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001') \gset g_

select pg_temp.check('identity and contact: name, phone, sign-in email, last sign-in', (
  :'g_full_name' = 'Gary Guard' and :'g_phone' = '+27820000001'
  and :'g_email' = 'gary.guard@example.com' and :'g_last_sign_in_at' <> ''));
select pg_temp.check('licence and placing agency', (
  :'g_psira_registration_number' = '4455667' and :'g_psira_grade' = 'C'
  and :'g_agency_name' = 'Gatekeepers Ltd'));
select pg_temp.check('on duty now', :'g_on_duty_since' <> '');
select pg_temp.check('shifts in the last 30 days include one that only overlaps it', :'g_shifts_30d'::int = 3);
select pg_temp.check('hours are clipped to the window: 8 + 24 + 1, not 8 + 48 + 1', (
  :'g_hours_on_duty_30d'::numeric between 32.5 and 33.5));
select pg_temp.check('verifications are windowed on the SERVER clock, not the device''s', (
  :'g_verifications_30d'::int = 3 and :'g_admitted_30d'::int = 2
  and :'g_rejected_30d'::int = 1 and :'g_offline_30d'::int = 1 and :'g_flagged_30d'::int = 1));

select count(*) as n from public.estate_guard_shifts(
  'e7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001') \gset sh_
select pg_temp.check('shift history lists every shift, newest first', :'sh_n'::int = 3 and (
  select ended_at is null from public.estate_guard_shifts(
    'e7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001') limit 1));

-- ─── ★ Tenant isolation ★ ────────────────────────────────────────────────────

-- Another estate's guard, named under the caller's own estate: no row.
select count(*) as n from public.estate_guard_profile(
  'e7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002') \gset x_
select pg_temp.check('another estate''s guard id under my estate returns nothing', :'x_n'::int = 0);
select count(*) as n from public.estate_guard_shifts(
  'e7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002') \gset xs_
select pg_temp.check('...nor their shifts', :'xs_n'::int = 0);

-- ...and named under THEIR estate: refused outright.
select pg_temp.raises('an admin cannot open another estate',
  $$select * from public.estate_guard_profile('e7000000-0000-4000-8000-000000000002',
                                              'a7000000-0000-4000-8000-000000000002')$$,
  'not_an_estate_admin');
select pg_temp.raises('...nor its shift history',
  $$select * from public.estate_guard_shifts('e7000000-0000-4000-8000-000000000002',
                                             'a7000000-0000-4000-8000-000000000002')$$,
  'not_an_estate_admin');

select count(*) as n from public.estate_guard_profile(
  'e7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003') \gset r_
select pg_temp.check('a resident''s membership id is not a guard profile', :'r_n'::int = 0);

set test.uid = 'c7000000-0000-4000-8000-000000000001';
select pg_temp.raises('a guard cannot read guard profiles, not even their own',
  $$select * from public.estate_guard_profile('e7000000-0000-4000-8000-000000000001',
                                              'a7000000-0000-4000-8000-000000000001')$$,
  'not_an_estate_admin');

reset test.uid;
select pg_temp.check('anon cannot execute either RPC', (
  not has_function_privilege('anon', 'public.estate_guard_profile(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.estate_guard_shifts(uuid,uuid,integer)', 'execute')));
