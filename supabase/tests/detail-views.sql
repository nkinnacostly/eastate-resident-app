-- Detail views on every dashboard: invariants.
--
-- Each detail RPC takes a TARGET id from the client. The tests that matter are
-- the ones where that id points outside the caller's scope, and the ones that
-- check what a view must NOT contain: the operator never sees a code string, an
-- agency never sees a resident or an individual entry, a landlord never sees a
-- tenant's name or personal dues.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end $$;

-- The "nothing raised" failure is raised outside the block that catches it, or
-- it catches itself and passes. See supabase/tests/operator-dues.sql.
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
--
--   Estate A (per_house)    House 1: Ada Okafor + Bo Bello, landlord Lola
--                           House 2: residents pay; Dee Dauda; landlord Lola too
--                           Guard: Gary Gate, placed by Agency X
--   Estate B (per_resident) Cy Chukwu; Gary is ALSO a resident here
--   Agency X holds a contract at A. Agency Y holds none anywhere.

insert into auth.users (id, email, last_sign_in_at) values
  ('c9000000-0000-4000-8000-0000000000d0', 'owner9@example.com', now()),
  ('c9000000-0000-4000-8000-0000000000a1', 'admina9@example.com', now()),
  ('c9000000-0000-4000-8000-0000000000b1', 'adminb9@example.com', now()),
  ('c9000000-0000-4000-8000-000000000001', 'ada9@example.com', now()),
  ('c9000000-0000-4000-8000-000000000002', 'bo9@example.com', null),
  ('c9000000-0000-4000-8000-000000000003', 'dee9@example.com', now()),
  ('c9000000-0000-4000-8000-000000000004', 'cy9@example.com', now()),
  ('c9000000-0000-4000-8000-000000000005', 'gary9@example.com', now()),
  ('c9000000-0000-4000-8000-000000000006', 'lola9@example.com', now()),
  ('c9000000-0000-4000-8000-0000000000e1', 'agx9@example.com', now()),
  ('c9000000-0000-4000-8000-0000000000e2', 'agy9@example.com', now());

insert into public.profiles (id, full_name, phone) values
  ('c9000000-0000-4000-8000-0000000000d0', 'Owner Nine', null),
  ('c9000000-0000-4000-8000-0000000000a1', 'Admin A', null),
  ('c9000000-0000-4000-8000-0000000000b1', 'Admin B', null),
  ('c9000000-0000-4000-8000-000000000001', 'Ada Okafor', '+2348000000091'),
  ('c9000000-0000-4000-8000-000000000002', 'Bo Bello', null),
  ('c9000000-0000-4000-8000-000000000003', 'Dee Dauda', null),
  ('c9000000-0000-4000-8000-000000000004', 'Cy Chukwu', null),
  ('c9000000-0000-4000-8000-000000000005', 'Gary Gate', '+2348000000095'),
  ('c9000000-0000-4000-8000-000000000006', 'Lola Landlord', null),
  ('c9000000-0000-4000-8000-0000000000e1', 'Agency X Admin', null),
  ('c9000000-0000-4000-8000-0000000000e2', 'Agency Y Admin', null);

insert into public.platform_admins (user_id) values ('c9000000-0000-4000-8000-0000000000d0');

insert into public.estates (id, name, join_code, dues_billing_mode, dues_amount_minor, dues_currency,
                            dues_grace_days, settlement_country, settlement_bank_code,
                            settlement_bank_name, settlement_account_number,
                            settlement_account_name, settlement_account_verified,
                            settlement_subaccount_ref, settlement_subaccount_id,
                            settlement_verified_at) values
  ('e9000000-0000-4000-8000-00000000000a', 'Estate A', 'JOINA9', 'per_house', 2500000, 'NGN', 7,
   'NG', '044', 'Access Bank', '0690000032', 'Estate A RA', true, 'RS_A9', '90090', now()),
  ('e9000000-0000-4000-8000-00000000000b', 'Estate B', 'JOINB9', 'per_resident', 1000000, 'NGN', 7,
   'NG', '044', 'Access Bank', '0690000033', 'Estate B RA', true, 'RS_B9', '90091', now());

insert into public.houses (id, estate_id, house_code, house_number, landlord_name, landlord_email,
                           dues_payer, dues_amount_minor) values
  ('f9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-00000000000a', 'DV01', '1',
   'Lola Landlord', 'lola9@example.com', null, null),
  ('f9000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-00000000000a', 'DV02', '2',
   'Lola Landlord', 'lola9@example.com', 'residents', 500000);

insert into public.agencies (id, name, registration_number, registration_body) values
  ('b9000000-0000-4000-8000-00000000000a', 'Agency X', '1110001', 'ZA-PSIRA'),
  ('b9000000-0000-4000-8000-00000000000b', 'Agency Y', '1110002', 'ZA-PSIRA');

insert into public.agency_memberships (id, agency_id, user_id, role) values
  ('ab900000-0000-4000-8000-0000000000e1', 'b9000000-0000-4000-8000-00000000000a', 'c9000000-0000-4000-8000-0000000000e1', 'admin'),
  ('ab900000-0000-4000-8000-0000000000e2', 'b9000000-0000-4000-8000-00000000000b', 'c9000000-0000-4000-8000-0000000000e2', 'admin'),
  ('ab900000-0000-4000-8000-000000000005', 'b9000000-0000-4000-8000-00000000000a', 'c9000000-0000-4000-8000-000000000005', 'officer');

insert into public.agency_contracts (agency_id, estate_id, starts_on) values
  ('b9000000-0000-4000-8000-00000000000a', 'e9000000-0000-4000-8000-00000000000a', now() - interval '60 days');

insert into public.memberships (id, user_id, estate_id, role, house_id, placed_by_agency_id) values
  ('a9000000-0000-4000-8000-0000000000a1','c9000000-0000-4000-8000-0000000000a1','e9000000-0000-4000-8000-00000000000a','admin',null,null),
  ('a9000000-0000-4000-8000-0000000000b1','c9000000-0000-4000-8000-0000000000b1','e9000000-0000-4000-8000-00000000000b','admin',null,null),
  ('a9000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-00000000000a','resident','f9000000-0000-4000-8000-000000000001',null),
  ('a9000000-0000-4000-8000-000000000002','c9000000-0000-4000-8000-000000000002','e9000000-0000-4000-8000-00000000000a','resident','f9000000-0000-4000-8000-000000000001',null),
  ('a9000000-0000-4000-8000-000000000003','c9000000-0000-4000-8000-000000000003','e9000000-0000-4000-8000-00000000000a','resident','f9000000-0000-4000-8000-000000000002',null),
  ('a9000000-0000-4000-8000-000000000004','c9000000-0000-4000-8000-000000000004','e9000000-0000-4000-8000-00000000000b','resident',null,null),
  ('a9000000-0000-4000-8000-000000000005','c9000000-0000-4000-8000-000000000005','e9000000-0000-4000-8000-00000000000a','guard',null,'b9000000-0000-4000-8000-00000000000a'),
  ('a9000000-0000-4000-8000-000000000015','c9000000-0000-4000-8000-000000000005','e9000000-0000-4000-8000-00000000000b','resident',null,null);

-- Ada's codes: one live, one past expiry but still stored 'active'.
insert into public.access_codes (id, code, estate_id, membership_id, status, expires_at, created_at) values
  ('ac900000-0000-4000-8000-000000000001', 'ADA9LV', 'e9000000-0000-4000-8000-00000000000a',
   'a9000000-0000-4000-8000-000000000001', 'active', now() + interval '3 hours', now() - interval '1 hour'),
  ('ac900000-0000-4000-8000-000000000002', 'ADA9XP', 'e9000000-0000-4000-8000-00000000000a',
   'a9000000-0000-4000-8000-000000000001', 'active', now() - interval '1 hour', now() - interval '8 hours');

-- Gary admits Ada's visitor, on shift. Both rows are stamped Agency X by trigger.
insert into public.guard_shifts (estate_id, membership_id, started_at) values
  ('e9000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-000000000005', now() - interval '2 hours');
insert into public.verification_events (client_event_id, estate_id, code_id, code_attempted,
    verified_by_membership_id, verified_at, source, outcome) values
  (gen_random_uuid(), 'e9000000-0000-4000-8000-00000000000a', 'ac900000-0000-4000-8000-000000000002',
   'ADA9XP', 'a9000000-0000-4000-8000-000000000005', now() - interval '7 hours', 'online', 'admitted');

select public.generate_dues_charges(date_trunc('month', current_date)::date);
select id as h1 from public.dues_charges where house_id = 'f9000000-0000-4000-8000-000000000001' \gset

-- Ada settles the house bill from the app.
set test.uid = 'c9000000-0000-4000-8000-000000000001';
select tx_ref as ada_ref from public.start_dues_payment(:'h1') \gset
reset test.uid;
select public.settle_dues_payment(:'ada_ref', 'FLW-901', 2500000, 'NGN', 'successful', '{}') as r \gset

-- ─── Estate admin: a resident ────────────────────────────────────────────────

set test.uid = 'c9000000-0000-4000-8000-0000000000a1';
select public.estate_resident_detail('e9000000-0000-4000-8000-00000000000a',
                                     'a9000000-0000-4000-8000-000000000001') as d \gset ada_

select pg_temp.check('a resident: name, contact, house and who pays their dues', (
  select d->'person'->>'full_name' = 'Ada Okafor' and d->'person'->>'email' = 'ada9@example.com'
     and d->'person'->>'house_number' = '1' and d->'person'->>'dues_payer' = 'landlord'
    from (select :'ada_d'::jsonb as d) x));
select pg_temp.check('...their household, by name', (
  select d->'household'->0->>'full_name' = 'Bo Bello' and jsonb_array_length(d->'household') = 1
    from (select :'ada_d'::jsonb as d) x));
select pg_temp.check('...live codes are DERIVED: the expired-but-active row does not count', (
  select (d->'stats'->>'live_codes')::int = 1 and (d->'stats'->>'codes_30d')::int = 2
     and (d->'stats'->>'visitors_admitted_30d')::int = 1
    from (select :'ada_d'::jsonb as d) x));
select pg_temp.check('...and the code list shows that row as expired', (
  select exists (select 1 from jsonb_array_elements(d->'codes') c
                  where c->>'code' = 'ADA9XP' and c->>'status' = 'expired')
    from (select :'ada_d'::jsonb as d) x));
select pg_temp.check('...the house bill appears on a landlord-billed resident, paid', (
  select exists (select 1 from jsonb_array_elements(d->'charges') c
                  where c->>'subject' = 'house' and c->>'status' = 'paid')
    from (select :'ada_d'::jsonb as d) x));

select pg_temp.check('another estate''s resident is not found, not leaked', (
  select public.estate_resident_detail('e9000000-0000-4000-8000-00000000000a',
                                       'a9000000-0000-4000-8000-000000000004') is null));
select pg_temp.check('a guard''s membership id is not a resident profile', (
  select public.estate_resident_detail('e9000000-0000-4000-8000-00000000000a',
                                       'a9000000-0000-4000-8000-000000000005') is null));
select pg_temp.raises('an admin cannot open another estate''s residents',
  $$select public.estate_resident_detail('e9000000-0000-4000-8000-00000000000b',
                                         'a9000000-0000-4000-8000-000000000004')$$,
  'not_an_estate_admin');

-- ─── Estate admin: a house ───────────────────────────────────────────────────

select public.estate_house_detail('e9000000-0000-4000-8000-00000000000a',
                                  'f9000000-0000-4000-8000-000000000001') as d \gset h1_
select pg_temp.check('a house: terms in force, both residents, its bill and gate traffic', (
  select d->'house'->>'dues_payer' = 'landlord' and (d->'house'->>'dues_amount_minor')::bigint = 2500000
     and jsonb_array_length(d->'residents') = 2
     and jsonb_array_length(d->'charges') = 1
     and (d->'stats'->>'visitors_admitted_30d')::int = 1
    from (select :'h1_d'::jsonb as d) x));

select pg_temp.check('each resident row carries what the residents table shows', (
  select r->>'email' = 'ada9@example.com' and r->>'last_sign_in_at' is not null
     and (r->>'live_codes')::int = 1 and (r->>'codes_30d')::int = 2
     and (r->>'in_arrears')::boolean = false
    from (select :'h1_d'::jsonb as d) x,
         jsonb_array_elements(d->'residents') r
   where r->>'full_name' = 'Ada Okafor'));
select pg_temp.check('...including a resident who has never signed in', (
  select r->>'last_sign_in_at' is null and (r->>'live_codes')::int = 0
    from (select :'h1_d'::jsonb as d) x,
         jsonb_array_elements(d->'residents') r
   where r->>'full_name' = 'Bo Bello'));

select public.estate_house_detail('e9000000-0000-4000-8000-00000000000a',
                                  'f9000000-0000-4000-8000-000000000002') as d \gset h2_
select pg_temp.check('a resident-billed house shows each resident''s charge, named', (
  select d->'house'->>'dues_payer' = 'residents'
     and d->'charges'->0->>'subject' = 'resident' and d->'charges'->0->>'resident_name' = 'Dee Dauda'
    from (select :'h2_d'::jsonb as d) x));

set test.uid = 'c9000000-0000-4000-8000-0000000000b1';
select pg_temp.check('another estate''s admin, naming their own estate, finds nothing', (
  select public.estate_house_detail('e9000000-0000-4000-8000-00000000000b',
                                    'f9000000-0000-4000-8000-000000000001') is null));

set test.uid = 'c9000000-0000-4000-8000-000000000001';
select pg_temp.raises('a resident cannot open resident profiles',
  $$select public.estate_resident_detail('e9000000-0000-4000-8000-00000000000a',
                                         'a9000000-0000-4000-8000-000000000002')$$,
  'not_an_estate_admin');

-- The guard RPCs now read the shared helper: same answers as before.
set test.uid = 'c9000000-0000-4000-8000-0000000000a1';
select pg_temp.check('the estate guard profile still answers after the refactor', (
  select full_name = 'Gary Gate' and agency_name = 'Agency X' and admitted_30d = 1 and on_duty_since is not null
    from public.estate_guard_profile('e9000000-0000-4000-8000-00000000000a',
                                     'a9000000-0000-4000-8000-000000000005')));
select pg_temp.check('...and still finds nothing for a non-guard membership', (
  select count(*) = 0 from public.estate_guard_profile('e9000000-0000-4000-8000-00000000000a',
                                                       'a9000000-0000-4000-8000-000000000001')));

-- ─── Platform owner: an estate ───────────────────────────────────────────────

set test.uid = 'c9000000-0000-4000-8000-0000000000d0';
select public.operator_estate_detail('e9000000-0000-4000-8000-00000000000a') as d \gset est_

select pg_temp.check('an estate: identity, head-counts and the guard on duty', (
  select d->'estate'->>'join_code' = 'JOINA9'
     and (d->'counts'->>'residents')::int = 3 and (d->'counts'->>'guards')::int = 1
     and (d->'counts'->>'admins')::int = 1
     and d->'gate_30d'->>'on_duty_name' = 'Gary Gate'
     and (d->'gate_30d'->>'admitted')::int = 1
    from (select :'est_d'::jsonb as d) x));
select pg_temp.check('...dues, payout account MASKED, and the agency contract', (
  select (d->'dues'->>'collected_30d_minor')::bigint = 2500000
     and d->'settlement'->>'account_mask' <> '0690000032'
     and right(d->'settlement'->>'account_mask', 4) = '0032'
     and d->'agencies'->0->>'agency_name' = 'Agency X' and (d->'agencies'->0->>'live')::boolean
    from (select :'est_d'::jsonb as d) x));
select pg_temp.check('...everyone on it, and every house', (
  select jsonb_array_length(d->'people') = 5 and jsonb_array_length(d->'houses') = 2
    from (select :'est_d'::jsonb as d) x));
select pg_temp.check('...gate entries name the host but NEVER carry a code', (
  select d->'events'->0->>'host_name' = 'Ada Okafor'
     and not ((d->'events')::text like '%ADA9%')
     and not (d->'events'->0 ? 'code') and not (d->'events'->0 ? 'code_attempted')
    from (select :'est_d'::jsonb as d) x));
select pg_temp.check('the full account number appears nowhere in the estate view', (
  select position('0690000032' in :'est_d') = 0));

-- ─── Platform owner: a person ────────────────────────────────────────────────

select public.operator_person_detail('c9000000-0000-4000-8000-000000000005') as d \gset gary_
select pg_temp.check('one page per human: guard at A AND resident at B', (
  select jsonb_array_length(d->'memberships') = 2
     and exists (select 1 from jsonb_array_elements(d->'memberships') m
                  where m->>'role' = 'guard' and m->>'estate_name' = 'Estate A'
                    and m->>'agency_name' = 'Agency X')
     and exists (select 1 from jsonb_array_elements(d->'memberships') m
                  where m->>'role' = 'resident' and m->>'estate_name' = 'Estate B')
    from (select :'gary_d'::jsonb as d) x));
select pg_temp.check('...with their guard stats, shifts and entries, code-free', (
  select jsonb_array_length(d->'guard') = 1 and (d->'guard'->0->>'admitted_30d')::int = 1
     and jsonb_array_length(d->'shifts') = 1 and jsonb_array_length(d->'events') = 1
     and jsonb_array_length(d->'agencies') = 1
     and not (d::text like '%ADA9%')
    from (select :'gary_d'::jsonb as d) x));

select pg_temp.check('a person who guards nowhere has empty guard lists, not an error', (
  select jsonb_array_length(d->'guard') = 0 and jsonb_array_length(d->'events') = 0
    from (select public.operator_person_detail('c9000000-0000-4000-8000-000000000004') as d) x));

set test.uid = 'c9000000-0000-4000-8000-0000000000a1';
select pg_temp.raises('an estate admin cannot open the operator''s estate view',
  $$select public.operator_estate_detail('e9000000-0000-4000-8000-00000000000a')$$, 'not_a_platform_admin');
select pg_temp.raises('...nor a person',
  $$select public.operator_person_detail('c9000000-0000-4000-8000-000000000001')$$, 'not_a_platform_admin');

-- ─── Agency: an officer ──────────────────────────────────────────────────────

set test.uid = 'c9000000-0000-4000-8000-0000000000e1';
select public.agency_officer_detail('ab900000-0000-4000-8000-000000000005') as d \gset off_
select pg_temp.check('an officer: licence-side identity, their posting, their stamped work', (
  select d->'officer'->>'full_name' = 'Gary Gate'
     and jsonb_array_length(d->'postings') = 1 and d->'postings'->0->>'estate_name' = 'Estate A'
     and d->'postings'->0->>'on_duty_since' is not null
     and (d->'stats_30d'->>'admitted')::int = 1 and (d->'stats_30d'->>'shifts')::int = 1
     and jsonb_array_length(d->'shifts') = 1
    from (select :'off_d'::jsonb as d) x));
-- ★ The privacy line ★
select pg_temp.check('...and nothing about anyone who came through the gate', (
  select position('Ada' in :'off_d') = 0 and position('ADA9' in :'off_d') = 0
     and position('Estate B' in :'off_d') = 0));

set test.uid = 'c9000000-0000-4000-8000-0000000000e2';
select pg_temp.raises('another agency cannot open the officer',
  $$select public.agency_officer_detail('ab900000-0000-4000-8000-000000000005')$$,
  'not_an_admin_at_this_agency');
select pg_temp.raises('...and an unknown id is refused the same way',
  $$select public.agency_officer_detail('ab900000-0000-4000-8000-0000000000ff')$$,
  'not_an_admin_at_this_agency');

-- ─── Agency: an estate ───────────────────────────────────────────────────────

set test.uid = 'c9000000-0000-4000-8000-0000000000e1';
select public.agency_estate_detail('b9000000-0000-4000-8000-00000000000a',
                                   'e9000000-0000-4000-8000-00000000000a') as d \gset ae_
select pg_temp.check('an estate it guards: the contract, its officers, six months of counts', (
  select jsonb_array_length(d->'contracts') = 1 and (d->'contracts'->0->>'live')::boolean
     and d->'officers'->0->>'full_name' = 'Gary Gate' and (d->'officers'->0->>'on_duty')::boolean
     and jsonb_array_length(d->'monthly') = 6 and (d->'monthly'->0->>'admitted')::int = 1
    from (select :'ae_d'::jsonb as d) x));
select pg_temp.check('...and still no resident, house or code in it', (
  select position('Ada' in :'ae_d') = 0 and position('ADA9' in :'ae_d') = 0
     and position('Lola' in :'ae_d') = 0));
select pg_temp.check('an estate it never guarded is not found', (
  select public.agency_estate_detail('b9000000-0000-4000-8000-00000000000a',
                                     'e9000000-0000-4000-8000-00000000000b') is null));

set test.uid = 'c9000000-0000-4000-8000-0000000000e2';
select pg_temp.check('another agency learns nothing about the estate', (
  select public.agency_estate_detail('b9000000-0000-4000-8000-00000000000b',
                                     'e9000000-0000-4000-8000-00000000000a') is null));
select pg_temp.raises('...and cannot ask in Agency X''s name',
  $$select public.agency_estate_detail('b9000000-0000-4000-8000-00000000000a',
                                       'e9000000-0000-4000-8000-00000000000a')$$,
  'not_an_admin_at_this_agency');

-- ─── Landlord: a house ───────────────────────────────────────────────────────

set test.uid = 'c9000000-0000-4000-8000-000000000006';
select public.landlord_house_detail('f9000000-0000-4000-8000-000000000001') as d \gset l1_
select pg_temp.check('a landlord''s house: its bill, paid, and how it was paid', (
  select d->'house'->>'estate_name' = 'Estate A' and (d->'house'->>'residents')::int = 2
     and d->'charges'->0->>'status' = 'paid'
     and d->'payments'->0->>'paid_via' = 'resident'
    from (select :'l1_d'::jsonb as d) x));
-- ★ The privacy line ★
select pg_temp.check('...without naming the tenant who paid it, or anyone living there', (
  select position('Ada' in :'l1_d') = 0 and position('Bo Bello' in :'l1_d') = 0
     and position('ada9@' in :'l1_d') = 0));

select public.landlord_house_detail('f9000000-0000-4000-8000-000000000002') as d \gset l2_
select pg_temp.check('a house that bills its residents shows the landlord NO tenant dues', (
  select d->'house'->>'dues_payer' = 'residents' and jsonb_array_length(d->'charges') = 0
     and jsonb_array_length(d->'payments') = 0 and position('Dee' in :'l2_d') = 0
    from (select :'l2_d'::jsonb as d) x));

set test.uid = 'c9000000-0000-4000-8000-000000000001';
select pg_temp.check('a tenant is not the landlord of the house they live in', (
  select public.landlord_house_detail('f9000000-0000-4000-8000-000000000001') is null));

-- ─── Privilege ───────────────────────────────────────────────────────────────

reset test.uid;
select pg_temp.check('no detail RPC is callable signed-out', (
  not has_function_privilege('anon', 'public.estate_resident_detail(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.estate_house_detail(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.operator_estate_detail(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.operator_person_detail(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.agency_officer_detail(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.agency_estate_detail(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.landlord_house_detail(uuid)', 'execute')));
select pg_temp.check('the shared helpers are not callable by any client role', (
  not has_function_privilege('authenticated', 'private.guard_profile_row(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.guard_shift_rows(uuid,integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.gate_event_rows(uuid,uuid[],integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.resident_detail(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.house_detail(uuid)', 'execute')));
