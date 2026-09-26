-- Invariants for the agency model and the PSIRA return.
--
-- These are the properties the design argument rests on. If one of them stops
-- holding, the argument for the shape is gone, not just a test.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end $$;

-- ─── Seed ────────────────────────────────────────────────────────────────────

insert into auth.users (id) values
  ('a0000000-0000-4000-8000-00000000000a'),  -- officer, placed by agency A
  ('a0000000-0000-4000-8000-00000000000b'),  -- agency A admin
  ('a0000000-0000-4000-8000-00000000000c'),  -- agency B admin (the outsider)
  ('a0000000-0000-4000-8000-00000000000d');  -- in-house guard, no agency

insert into public.profiles (id, full_name, phone, psira_registration_number, psira_grade, psira_verified_at) values
  ('a0000000-0000-4000-8000-00000000000a', 'Thabo Officer', '+27 82 000 0001', '1234567', 'C', now() - interval '10 days'),
  ('a0000000-0000-4000-8000-00000000000b', 'Agency A Admin', null, null, null, null),
  ('a0000000-0000-4000-8000-00000000000c', 'Agency B Admin', null, null, null, null),
  ('a0000000-0000-4000-8000-00000000000d', 'In-house Guard', '+27 82 000 0004', '7654321', 'D', null);

insert into public.agencies (id, name, registration_number, registration_body) values
  ('b0000000-0000-4000-8000-000000000001', 'Alpha Security', '2845678', 'ZA-PSIRA'),
  ('b0000000-0000-4000-8000-000000000002', 'Bravo Guarding', '9988776', 'ZA-PSIRA');

insert into public.agency_memberships (id, agency_id, user_id, role) values
  ('c1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-00000000000a', 'officer'),
  ('c1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-00000000000b', 'admin'),
  ('c1000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-00000000000c', 'admin');

-- Two estates, both guarded by the same officer placed by the same agency.
-- This is the multi-estate case the whole revocation argument is about.
insert into public.estates (id, name, address) values
  ('e1000000-0000-4000-8000-000000000001', 'Kelvin Grove', '1 Grove Rd, Cape Town'),
  ('e1000000-0000-4000-8000-000000000002', 'Silver Oaks',  '9 Oak Ave, Cape Town');

insert into public.memberships (id, user_id, estate_id, role, placed_by_agency_id) values
  ('d1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   'e1000000-0000-4000-8000-000000000001', 'guard', 'b0000000-0000-4000-8000-000000000001'),
  ('d1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a',
   'e1000000-0000-4000-8000-000000000002', 'guard', 'b0000000-0000-4000-8000-000000000001'),
  -- Same estate, guard the estate employs directly. Must survive an agency
  -- revocation: in-house security is a legally distinct arrangement, not a
  -- degenerate case of contracting.
  ('d1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000d',
   'e1000000-0000-4000-8000-000000000001', 'guard', null);

-- ─── Contracts ───────────────────────────────────────────────────────────────

insert into public.agency_contracts (agency_id, estate_id, starts_on) values
  ('b0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
   now() - interval '1 year');

-- Overlapping terms for the same pair are a data-entry error that would make
-- "who is contracted here" unanswerable. The exclusion constraint, not the
-- application, is what makes that impossible.
do $$
begin
  insert into public.agency_contracts (agency_id, estate_id, starts_on)
  values ('b0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
          now() - interval '6 months');
  raise exception 'FAIL  overlapping contracts were accepted';
exception
  when exclusion_violation then raise notice 'PASS  overlapping contracts rejected';
end $$;

-- A different agency at the same estate is fine -- a handover period, or two
-- companies covering different gates.
insert into public.agency_contracts (agency_id, estate_id, starts_on, ends_on) values
  ('b0000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002',
   now() - interval '2 years', now() - interval '1 year');

select pg_temp.check('a second agency at the same estate is allowed', (
  select count(*) = 1 from public.agency_contracts
   where agency_id = 'b0000000-0000-4000-8000-000000000002'));

-- Liveness is derived, never stored. No cron keeps this true.
select pg_temp.check('live contract is found by range containment', (
  select count(*) = 1 from public.agency_contracts
   where estate_id = 'e1000000-0000-4000-8000-000000000001'
     and during @> now() and revoked_at is null));

select pg_temp.check('an ended contract is not live, with nothing to update it', (
  select count(*) = 0 from public.agency_contracts
   where agency_id = 'b0000000-0000-4000-8000-000000000002' and during @> now()));

-- ─── Provenance is stamped, not derived ──────────────────────────────────────

insert into public.guard_shifts (id, estate_id, membership_id, started_at, ended_at) values
  ('f1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000001',
   date_trunc('month', now()) + interval '2 days',
   date_trunc('month', now()) + interval '2 days 12 hours'),
  ('f1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002',
   'd1000000-0000-4000-8000-000000000002',
   date_trunc('month', now()) + interval '3 days',
   date_trunc('month', now()) + interval '3 days 8 hours 30 minutes');

select pg_temp.check('a shift is stamped with the placing agency on insert', (
  select agency_id = 'b0000000-0000-4000-8000-000000000001'
  from public.guard_shifts where id = 'f1000000-0000-4000-8000-000000000001'));

insert into public.verification_events
  (id, client_event_id, estate_id, code_attempted, verified_by_membership_id,
   verified_at, synced_at, source, outcome)
values
  ('a9000000-0000-4000-8000-000000000001', gen_random_uuid(),
   'e1000000-0000-4000-8000-000000000001', 'ABC123',
   'd1000000-0000-4000-8000-000000000001', now(), now(), 'online', 'admitted');

select pg_temp.check('an event is stamped with the placing agency on insert', (
  select agency_id = 'b0000000-0000-4000-8000-000000000001'
  from public.verification_events where id = 'a9000000-0000-4000-8000-000000000001'));

-- An in-house guard has no agency, and that must be representable rather than
-- forced to a placeholder.
insert into public.guard_shifts (id, estate_id, membership_id, started_at) values
  ('f1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000003', now());

select pg_temp.check('an in-house shift is stamped with no agency', (
  select agency_id is null from public.guard_shifts
   where id = 'f1000000-0000-4000-8000-000000000003'));

-- THE provenance invariant. Reassigning the officer tomorrow must not rewrite
-- who was responsible today.
update public.memberships set placed_by_agency_id = 'b0000000-0000-4000-8000-000000000002'
 where id = 'd1000000-0000-4000-8000-000000000001';

select pg_temp.check('reassignment does not rewrite past shifts', (
  select agency_id = 'b0000000-0000-4000-8000-000000000001'
  from public.guard_shifts where id = 'f1000000-0000-4000-8000-000000000001'));

select pg_temp.check('reassignment does not rewrite past events', (
  select agency_id = 'b0000000-0000-4000-8000-000000000001'
  from public.verification_events where id = 'a9000000-0000-4000-8000-000000000001'));

-- ...and it cannot be rewritten deliberately either.
do $$
begin
  update public.verification_events
     set agency_id = 'b0000000-0000-4000-8000-000000000002'
   where id = 'a9000000-0000-4000-8000-000000000001';
  raise exception 'FAIL  agency stamp was editable';
exception
  when check_violation then raise notice 'PASS  agency stamp cannot be edited';
end $$;

-- Put it back for the tests below.
update public.memberships set placed_by_agency_id = 'b0000000-0000-4000-8000-000000000001'
 where id = 'd1000000-0000-4000-8000-000000000001';

-- ─── Cross-estate revocation in one write ────────────────────────────────────

-- POSITIVE CONTROL FIRST, and it is not ceremony.
--
-- The first version of these tests used SET LOCAL outside a transaction, which
-- Postgres ignores with a warning. auth.uid() was therefore null for every
-- call, nobody was an admin, and both refusal tests passed for entirely the
-- wrong reason -- they were measuring a broken fixture, not a boundary. This
-- asserts the identity mechanism works before anything relies on it refusing.
set test.uid = 'a0000000-0000-4000-8000-00000000000b';
select pg_temp.check('the test fixture can actually set a caller identity', (
  select (select auth.uid()) = 'a0000000-0000-4000-8000-00000000000b'::uuid));

select pg_temp.check('agency A admin is recognised as an admin of agency A', (
  select exists (
    select 1 from public.agency_memberships am
     where am.agency_id = 'b0000000-0000-4000-8000-000000000001'
       and am.user_id = (select auth.uid())
       and am.role = 'admin' and am.is_active)));

-- An admin at ANOTHER agency must not be able to touch this roster. Without
-- this check the RPC is a confused deputy: it holds rights everywhere, and the
-- caller names the target.
set test.uid = 'a0000000-0000-4000-8000-00000000000c';
do $$
begin
  perform public.agency_deactivate_officer('c1000000-0000-4000-8000-000000000001');
  raise exception 'FAIL  another agency''s admin revoked our officer';
exception
  when insufficient_privilege then raise notice 'PASS  another agency''s admin is refused';
end $$;

-- An officer is not an admin of their own agency either.
set test.uid = 'a0000000-0000-4000-8000-00000000000a';
do $$
begin
  perform public.agency_deactivate_officer('c1000000-0000-4000-8000-000000000001');
  raise exception 'FAIL  a non-admin revoked an officer';
exception
  when insufficient_privilege then raise notice 'PASS  a non-admin is refused';
end $$;

-- The real thing: one write, and the officer is out at BOTH estates.
set test.uid = 'a0000000-0000-4000-8000-00000000000b';
select public.agency_deactivate_officer('c1000000-0000-4000-8000-000000000001') as revoked \gset

select pg_temp.check('one call withdraws both estate memberships', :revoked = 2);

select pg_temp.check('officer is inactive at every estate the agency placed them', (
  select count(*) = 0 from public.memberships
   where user_id = 'a0000000-0000-4000-8000-00000000000a' and is_active));

select pg_temp.check('the agency employment record is closed too', (
  select not is_active from public.agency_memberships
   where id = 'c1000000-0000-4000-8000-000000000001'));

-- The estate's own guard is untouched. The agency has no authority over someone
-- it did not place.
select pg_temp.check('an in-house guard survives the agency revocation', (
  select is_active from public.memberships
   where id = 'd1000000-0000-4000-8000-000000000003'));

-- ─── The PSIRA return ────────────────────────────────────────────────────────

set test.uid = 'a0000000-0000-4000-8000-00000000000b';

select count(*) as n from public.agency_monthly_return(
  'b0000000-0000-4000-8000-000000000001', current_date) \gset return_

-- One row per officer per estate worked: the officer above worked two.
select pg_temp.check('return has one row per officer per estate', :return_n = 2);

select hours as h, registration_number as reg, grade as g, estate_address as addr
  from public.agency_monthly_return('b0000000-0000-4000-8000-000000000001', current_date)
 where estate_name = 'Silver Oaks' \gset row_

-- 8h30m must not round to 8 or 9. Across a month of posts that is the
-- difference between a correct return and a materially misleading one.
select pg_temp.check('hours are exact to two places', :'row_h'::numeric = 8.50);

-- reg 10(7)(f) wants the registration number, the grade and the address of the
-- place the service was rendered. All three come back.
select pg_temp.check('return carries registration number', :'row_reg' = '1234567');
select pg_temp.check('return carries training grade', :'row_g' = 'C');
select pg_temp.check('return carries the site address', :'row_addr' = '9 Oak Ave, Cape Town');

-- Revoked officers still appear: the return covers everyone employed or
-- deployed during the month, and dismissal mid-month does not erase the shifts
-- they worked before it.
select pg_temp.check('a dismissed officer still appears in the month worked', (
  select count(*) = 2 from public.agency_monthly_return(
    'b0000000-0000-4000-8000-000000000001', current_date)));

-- Another agency's admin gets nothing, not even an empty set.
set test.uid = 'a0000000-0000-4000-8000-00000000000c';
do $$
begin
  perform * from public.agency_monthly_return('b0000000-0000-4000-8000-000000000001', current_date);
  raise exception 'FAIL  another agency read our return';
exception
  when insufficient_privilege then raise notice 'PASS  another agency cannot read the return';
end $$;

-- ─── Retention and provenance coexist ────────────────────────────────────────

-- The agency stamp is NOT personal information -- it names a company -- so it
-- must survive de-identification. Otherwise a cleared register could no longer
-- answer "which company was guarding us in March", which is aggregate,
-- non-identifying, and exactly what an estate reviewing a contract asks.
update public.verification_events
   set synced_at = now() - interval '200 days'
 where id = 'a9000000-0000-4000-8000-000000000001';

reset test.uid;
select * from public.apply_retention() \gset ret_

select pg_temp.check('de-identification keeps the agency stamp', (
  select agency_id = 'b0000000-0000-4000-8000-000000000001'
     and verified_by_membership_id is null
     and de_identified_at is not null
  from public.verification_events where id = 'a9000000-0000-4000-8000-000000000001'));
