-- Estate dues: invariants.
--
-- This is money, so the bar is higher than elsewhere. The list is built from
-- Flutterwave's own verification checklist, Stripe's fulfilment guidance
-- ("your fulfill function might be called multiple times, possibly
-- concurrently"), and OWASP WSTG-BUSL-03 on integrity checks.
--
-- Note what is NOT tested here and cannot be: that the Edge Function verifies
-- against Flutterwave before calling settle. That is enforced in TypeScript and
-- covered by the function's own tests. What IS tested is that settle refuses to
-- give value even when a caller lies to it -- so a bug there costs nothing.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end $$;

-- ─── Seed ────────────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-000000000001', 'ada@example.com'),   -- house 1, per_house estate
  ('c0000000-0000-4000-8000-000000000002', 'bem@example.com'),   -- house 1 (same house)
  ('c0000000-0000-4000-8000-000000000003', 'chi@example.com'),   -- house 2
  ('c0000000-0000-4000-8000-000000000004', 'dayo@example.com'),  -- per_resident estate
  ('c0000000-0000-4000-8000-000000000005', 'efe@example.com'),   -- per_resident estate
  ('c0000000-0000-4000-8000-000000000006', 'funke@example.com'), -- free estate
  ('c0000000-0000-4000-8000-000000000007', 'gbemi@example.com'), -- per_house, NO house
  ('c0000000-0000-4000-8000-00000000000a', 'admin@example.com');

insert into public.profiles (id, full_name) values
  ('c0000000-0000-4000-8000-000000000001', 'Ada'),
  ('c0000000-0000-4000-8000-000000000002', 'Bem'),
  ('c0000000-0000-4000-8000-000000000003', 'Chi'),
  ('c0000000-0000-4000-8000-000000000004', 'Dayo'),
  ('c0000000-0000-4000-8000-000000000005', 'Efe'),
  ('c0000000-0000-4000-8000-000000000006', 'Funke'),
  ('c0000000-0000-4000-8000-000000000007', 'Gbemi'),
  ('c0000000-0000-4000-8000-00000000000a', 'Admin');

-- Both dues-enabled estates carry settlement details, because since
-- 20260927190000 an estate CANNOT bill without them -- estates_dues_need_
-- settlement_ck rejects the row outright. That is the invariant working: a
-- fixture that could still be written would mean charges could be raised with
-- nowhere for the money to go.
insert into public.estates (id, name, dues_billing_mode, dues_amount_minor, dues_currency, dues_grace_days,
                            settlement_country, settlement_bank_code, settlement_bank_name,
                            settlement_account_number, settlement_account_name,
                            settlement_account_verified, settlement_subaccount_ref,
                            settlement_subaccount_id, settlement_verified_at, platform_fee_percent) values
  ('e2000000-0000-4000-8000-000000000001', 'Landlord Estate', 'per_house',    2500000, 'NGN', 7,
   'NG', '044', 'Access Bank', '0690000032', 'Landlord Estate Residents Association',
   true, 'RS_LANDLORDESTATE0000000000000001', '90001', now(), 0.0300),
  ('e2000000-0000-4000-8000-000000000002', 'Flats Estate',    'per_resident',  750000, 'NGN', 7,
   'NG', '058', 'GTBank', '0123456789', 'Flats Estate Body Corporate',
   true, 'RS_FLATSESTATE00000000000000001', '90002', now(), 0);
insert into public.estates (id, name) values
  ('e2000000-0000-4000-8000-000000000003', 'Free Estate');

insert into public.houses (id, estate_id, house_code, house_number, landlord_email) values
  ('f2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'AAAA', '12', 'landlord@example.com'),
  ('f2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001', 'BBBB', '14', null);

insert into public.memberships (id, user_id, estate_id, role, house_id) values
  ('a2000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','resident','f2000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','resident','f2000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001','resident','f2000000-0000-4000-8000-000000000002'),
  ('a2000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000002','resident',null),
  ('a2000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000002','resident',null),
  ('a2000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000006','e2000000-0000-4000-8000-000000000003','resident',null),
  ('a2000000-0000-4000-8000-000000000007','c0000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000001','resident',null),
  ('a2000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-00000000000a','e2000000-0000-4000-8000-000000000001','admin',null),
  -- Same human, admin at both billing estates. Authority is per estate, so the
  -- second membership is required rather than implied by the first.
  ('a2000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-00000000000a','e2000000-0000-4000-8000-000000000002','admin',null);

-- ─── Configuration is coherent or absent ─────────────────────────────────────

do $$
begin
  insert into public.estates (name, dues_billing_mode) values ('Broken', 'per_house');
  raise exception 'FAIL  a billing mode with no amount was accepted';
exception when check_violation then
  raise notice 'PASS  a billing mode with no amount is rejected';
end $$;

do $$
begin
  update public.estates set dues_grace_days = 400
   where id = 'e2000000-0000-4000-8000-000000000001';
  raise exception 'FAIL  an absurd grace period was accepted';
exception when check_violation then
  raise notice 'PASS  grace period is bounded';
end $$;

-- ─── Raising charges ─────────────────────────────────────────────────────────

select public.generate_dues_charges(date_trunc('month', current_date)::date) as n \gset gen_

-- 2 houses + 2 residents at the flats estate. The free estate raises nothing,
-- and the per_house estate raises nothing per-resident.
select pg_temp.check('a run raises one charge per billable subject', :gen_n = 4);

select pg_temp.check('the free estate is not billed', (
  select count(*) = 0 from public.dues_charges
   where estate_id = 'e2000000-0000-4000-8000-000000000003'));

select pg_temp.check('a per-house estate raises house charges, not resident ones', (
  select count(*) filter (where house_id is not null) = 2
     and count(*) filter (where membership_id is not null) = 0
  from public.dues_charges where estate_id = 'e2000000-0000-4000-8000-000000000001'));

-- THE property that makes a failed cron safe to re-run by hand, which is the
-- only situation anyone will ever invoke this in.
select public.generate_dues_charges(date_trunc('month', current_date)::date) as n \gset rerun_
select pg_temp.check('re-running the month double-bills nobody', :rerun_n = 0);

select pg_temp.check('due date is period plus grace', (
  select bool_and(due_on = period + 7) from public.dues_charges));

-- A ledger records what was owed THEN. Raising the rate must not restate it.
update public.estates set dues_amount_minor = 9900000
 where id = 'e2000000-0000-4000-8000-000000000001';
select pg_temp.check('an existing charge keeps the amount it was raised at', (
  select bool_and(amount_minor = 2500000) from public.dues_charges
   where estate_id = 'e2000000-0000-4000-8000-000000000001'));
update public.estates set dues_amount_minor = 2500000
 where id = 'e2000000-0000-4000-8000-000000000001';

-- ─── The gate ────────────────────────────────────────────────────────────────

-- ─── Enforcement needs recorded authority ────────────────────────────────────
--
-- Configuring an amount is a billing decision; withholding a service over
-- arrears is a legal one. CSOS classifies a rule denying access for unpaid
-- levies as undesirable and will refuse to register it, so an estate that has
-- not recorded a basis must bill normally and restrict nobody.
update public.dues_charges set due_on = current_date - 1;
select pg_temp.check('arrears do NOT block until enforcement is authorised', (
  select not public.dues_in_arrears('a2000000-0000-4000-8000-000000000001')));

set test.uid = 'c0000000-0000-4000-8000-00000000000a';
do $$
begin
  perform public.set_dues_enforcement('e2000000-0000-4000-8000-000000000001', true, '  ');
  raise exception 'FAIL  enforcement was authorised with no basis';
exception when sqlstate '22023' then
  raise notice 'PASS  authorising enforcement requires a recorded basis';
end $$;

set test.uid = 'c0000000-0000-4000-8000-000000000001';
do $$
begin
  perform public.set_dues_enforcement('e2000000-0000-4000-8000-000000000001', true, 'MOI 11.4');
  raise exception 'FAIL  a resident authorised enforcement';
exception when insufficient_privilege then
  raise notice 'PASS  only an admin may authorise enforcement';
end $$;

set test.uid = 'c0000000-0000-4000-8000-00000000000a';
select public.set_dues_enforcement('e2000000-0000-4000-8000-000000000001', true, 'MOI clause 11.4, AGM 2026-03-14');
select public.set_dues_enforcement('e2000000-0000-4000-8000-000000000002', true, 'House rules 7(b)');

-- The PERSON, not their membership. Changed in 20260927210000, which moved
-- this key off memberships -- an estate's record of its own decision must not
-- decay when a committee member moves out and their membership is deactivated.
select pg_temp.check('authorising records who and on what basis', (
  select dues_enforcement_authorised_by = 'c0000000-0000-4000-8000-00000000000a'
     and dues_enforcement_basis = 'MOI clause 11.4, AGM 2026-03-14'
     and dues_enforcement_authorised_at is not null
  from public.estates where id = 'e2000000-0000-4000-8000-000000000001'));

select pg_temp.check('...and now arrears bite', (
  select public.dues_in_arrears('a2000000-0000-4000-8000-000000000001')));

-- Withdrawing it clears the basis: a stale one left behind would later read as
-- authority nobody currently claims.
select public.set_dues_enforcement('e2000000-0000-4000-8000-000000000001', false);
select pg_temp.check('withdrawing authority stops enforcement and clears the basis', (
  select not public.dues_in_arrears('a2000000-0000-4000-8000-000000000001')
     and (select dues_enforcement_basis is null from public.estates
           where id = 'e2000000-0000-4000-8000-000000000001')));
select public.set_dues_enforcement('e2000000-0000-4000-8000-000000000001', true, 'MOI clause 11.4, AGM 2026-03-14');

-- Due dates are set explicitly from here on. Relying on "this month's charge
-- is still inside its grace period" would make the whole suite pass only in
-- the first week of a month -- and this run, on the 27th, is exactly how that
-- was caught.
update public.dues_charges set due_on = current_date + 3;

select pg_temp.check('a charge inside its grace period blocks nobody', (
  select not public.dues_in_arrears('a2000000-0000-4000-8000-000000000001')));

-- Age house 1's charge past its due date.
update public.dues_charges set due_on = current_date - 1
 where house_id = 'f2000000-0000-4000-8000-000000000001';

select pg_temp.check('an overdue house charge blocks a resident of that house', (
  select public.dues_in_arrears('a2000000-0000-4000-8000-000000000001')));

-- The whole point of per-house billing: the debt is the house's.
select pg_temp.check('...and blocks the OTHER resident of the same house', (
  select public.dues_in_arrears('a2000000-0000-4000-8000-000000000002')));

select pg_temp.check('...and does not touch a resident of a different house', (
  select not public.dues_in_arrears('a2000000-0000-4000-8000-000000000003')));

select pg_temp.check('a resident of a free estate is never blocked', (
  select not public.dues_in_arrears('a2000000-0000-4000-8000-000000000006')));

-- Fail OPEN on a data gap. house_id postdates memberships and is nullable;
-- locking someone out of their own gate because of a hole in our schema is the
-- wrong way to fail.
select pg_temp.check('a resident with no house on record is not blocked', (
  select not public.dues_in_arrears('a2000000-0000-4000-8000-000000000007')));

-- Per-resident billing isolates properly.
update public.dues_charges set due_on = current_date - 1
 where membership_id = 'a2000000-0000-4000-8000-000000000004';
select pg_temp.check('per-resident arrears block only that resident', (
  select public.dues_in_arrears('a2000000-0000-4000-8000-000000000004')
     and not public.dues_in_arrears('a2000000-0000-4000-8000-000000000005')));

-- Arrears, not "is this month paid". An old debt keeps blocking even while the
-- current month is still inside its grace window.
insert into public.dues_charges (estate_id, period, membership_id, amount_minor, currency, due_on)
values ('e2000000-0000-4000-8000-000000000002',
        (date_trunc('month', current_date) - interval '1 month')::date,
        'a2000000-0000-4000-8000-000000000005', 750000, 'NGN',
        (date_trunc('month', current_date) - interval '1 month')::date + 7);
select pg_temp.check('last month''s unpaid charge blocks this month', (
  select public.dues_in_arrears('a2000000-0000-4000-8000-000000000005')));

-- ─── Waiving ─────────────────────────────────────────────────────────────────

set test.uid = 'c0000000-0000-4000-8000-000000000003';
do $$
declare v_id uuid;
begin
  select id into v_id from public.dues_charges
   where house_id = 'f2000000-0000-4000-8000-000000000001';
  perform public.waive_dues_charge(v_id, 'hardship');
  raise exception 'FAIL  a resident waived their own charge';
exception when insufficient_privilege then
  raise notice 'PASS  a resident cannot waive their own charge';
end $$;

set test.uid = 'c0000000-0000-4000-8000-00000000000a';
select set_config('test.charge',
  (select id::text from public.dues_charges where house_id = 'f2000000-0000-4000-8000-000000000001'),
  false);

do $$
begin
  perform public.waive_dues_charge(current_setting('test.charge')::uuid, '   ');
  raise exception 'FAIL  a waiver with no reason was accepted';
exception when sqlstate '22023' then
  raise notice 'PASS  a waiver requires a reason';
end $$;

select public.waive_dues_charge(current_setting('test.charge')::uuid, 'Hardship, agreed at AGM');

select pg_temp.check('a waived charge stops blocking', (
  select not public.dues_in_arrears('a2000000-0000-4000-8000-000000000001')));

select pg_temp.check('a waiver records who and why', (
  select waived_by_membership_id = 'a2000000-0000-4000-8000-00000000000a'
     and waive_reason = 'Hardship, agreed at AGM' and waived_at is not null
  from public.dues_charges where id = current_setting('test.charge')::uuid));

-- ─── mint_access_code ────────────────────────────────────────────────────────

-- Re-block house 1 via a new overdue charge, so the gate has something to bite.
insert into public.dues_charges (estate_id, period, house_id, amount_minor, currency, due_on)
values ('e2000000-0000-4000-8000-000000000001',
        (date_trunc('month', current_date) - interval '2 months')::date,
        'f2000000-0000-4000-8000-000000000001', 2500000, 'NGN', current_date - 30);

set test.uid = 'c0000000-0000-4000-8000-000000000001';
select result as r from public.mint_access_code('e2000000-0000-4000-8000-000000000001') \gset mint_
select pg_temp.check('minting is refused while in arrears', :'mint_r' = 'dues_unpaid');

select pg_temp.check('no code was issued', (
  select count(*) = 0 from public.access_codes
   where membership_id = 'a2000000-0000-4000-8000-000000000001'));

-- THE one that matters most about WHERE the check sits. If the gate raised, or
-- sat before the limiter, an account in arrears would get unlimited free
-- attempts -- the exact inversion the no-RAISE rule exists to prevent.
select pg_temp.check('a refused attempt still advances the rate limiter', (
  select hits >= 1 from public.code_mint_attempts
   where membership_id = 'a2000000-0000-4000-8000-000000000001'));

-- And paying up restores service immediately, with no sweep in between.
update public.dues_charges set status = 'paid', paid_at = now()
 where house_id = 'f2000000-0000-4000-8000-000000000001' and status = 'open';
select result as r from public.mint_access_code('e2000000-0000-4000-8000-000000000001') \gset ok_
select pg_temp.check('paying restores minting on the very next call', :'ok_r' = 'ok');

-- ─── Starting a payment ──────────────────────────────────────────────────────

insert into public.dues_charges (id, estate_id, period, house_id, amount_minor, currency, due_on)
values ('d2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001',
        (date_trunc('month', current_date) + interval '1 month')::date,
        'f2000000-0000-4000-8000-000000000001', 2500000, 'NGN',
        (date_trunc('month', current_date) + interval '1 month')::date + 7);

-- A neighbour must not be able to start a payment against another house: it
-- would tell them exactly what that house owes.
set test.uid = 'c0000000-0000-4000-8000-000000000003';
select reason as r from public.start_dues_payment('d2000000-0000-4000-8000-000000000001') \gset other_
select pg_temp.check('a resident of another house cannot pay this charge', :'other_r' = 'not_your_charge');

-- Nor may someone from an entirely different estate.
set test.uid = 'c0000000-0000-4000-8000-000000000004';
select reason as r from public.start_dues_payment('d2000000-0000-4000-8000-000000000001') \gset outsider_
select pg_temp.check('a resident of another estate is refused', :'outsider_r' = 'not_a_resident');

set test.uid = 'c0000000-0000-4000-8000-000000000001';
select ok, tx_ref, amount_minor as amt from public.start_dues_payment('d2000000-0000-4000-8000-000000000001') \gset pay_
select pg_temp.check('a resident of the house may pay it', :'pay_ok');
select pg_temp.check('the reference matches the v4 format we will need later',
  :'pay_tx_ref' ~ '^[a-zA-Z0-9-]{6,42}$');
select pg_temp.check('the amount is frozen from the charge', :pay_amt = 2500000);

-- ─── Settlement ──────────────────────────────────────────────────────────────

-- Currency first: 2,500,000 ZAR against a 2,500,000 NGN charge passes any
-- amount-only check and is worth roughly fifteen times too much.
select public.settle_dues_payment(:'pay_tx_ref', 'FLW-1', 2500000, 'ZAR', 'successful', '{}'::jsonb) as r \gset cur_
select pg_temp.check('a currency mismatch is refused', :'cur_r' = 'currency_mismatch');

select public.settle_dues_payment(:'pay_tx_ref', 'FLW-1', 2499999, 'NGN', 'successful', '{}'::jsonb) as r \gset amt_
select pg_temp.check('one kobo short is refused', :'amt_r' = 'amount_mismatch');

select pg_temp.check('neither mismatch settled the charge', (
  select status = 'open' from public.dues_charges where id = 'd2000000-0000-4000-8000-000000000001'));

select public.settle_dues_payment('dues-never-issued', 'FLW-X', 2500000, 'NGN', 'successful', '{}'::jsonb) as r \gset unk_
select pg_temp.check('a reference we never issued gives no value', :'unk_r' = 'unknown_reference');

-- A failed attempt. Recorded, charge untouched.
select public.settle_dues_payment(:'pay_tx_ref', 'FLW-1', 2500000, 'NGN', 'failed', '{"x":1}'::jsonb) as r \gset fail_
select pg_temp.check('a failed charge is recorded, not credited', :'fail_r' = 'recorded_failure');
select pg_temp.check('the charge is still open after a failure', (
  select status = 'open' from public.dues_charges where id = 'd2000000-0000-4000-8000-000000000001'));

-- FAILED IS NOT TERMINAL. A customer can reopen checkout and complete payment
-- against the same reference after an earlier decline. A state machine that
-- forbids failed -> successful rejects money already received.
select public.settle_dues_payment(:'pay_tx_ref', 'FLW-1', 2500000, 'NGN', 'successful', '{"ok":1}'::jsonb) as r \gset retry_
select pg_temp.check('a previously failed payment can still succeed', :'retry_r' = 'settled');
select pg_temp.check('the charge is now paid', (
  select status = 'paid' and paid_at is not null
  from public.dues_charges where id = 'd2000000-0000-4000-8000-000000000001'));

-- IDEMPOTENCY. The webhook redelivers; the redirect also reports. Same answer,
-- no second credit.
select public.settle_dues_payment(:'pay_tx_ref', 'FLW-1', 2500000, 'NGN', 'successful', '{}'::jsonb) as r \gset dup_
select pg_temp.check('a replayed settlement is a no-op', :'dup_r' = 'already_settled');
select pg_temp.check('exactly one payment row is successful', (
  select count(*) = 1 from public.dues_payments
   where charge_id = 'd2000000-0000-4000-8000-000000000001' and status = 'successful'));

-- Overpayment is accepted, per Flutterwave's prose ("greater or equal"), not
-- their code sample's strict equality.
insert into public.dues_charges (id, estate_id, period, membership_id, amount_minor, currency, due_on)
values ('d2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002',
        (date_trunc('month', current_date) + interval '1 month')::date,
        'a2000000-0000-4000-8000-000000000004', 750000, 'NGN',
        (date_trunc('month', current_date) + interval '1 month')::date + 7);
set test.uid = 'c0000000-0000-4000-8000-000000000004';
select tx_ref from public.start_dues_payment('d2000000-0000-4000-8000-000000000002') \gset over_
select public.settle_dues_payment(:'over_tx_ref', 'FLW-2', 800000, 'NGN', 'successful', '{}'::jsonb) as r \gset overr_
select pg_temp.check('an overpayment is accepted', :'overr_r' = 'settled');

-- Two attempts on one charge: the second is real money and is recorded, but the
-- charge is not paid twice.
set test.uid = 'c0000000-0000-4000-8000-000000000001';
insert into public.dues_charges (id, estate_id, period, house_id, amount_minor, currency, due_on)
values ('d2000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001',
        (date_trunc('month', current_date) + interval '2 months')::date,
        'f2000000-0000-4000-8000-000000000001', 2500000, 'NGN', current_date + 60);
select tx_ref from public.start_dues_payment('d2000000-0000-4000-8000-000000000003') \gset t1_
select tx_ref from public.start_dues_payment('d2000000-0000-4000-8000-000000000003') \gset t2_
select pg_temp.check('two attempts get different references', :'t1_tx_ref' <> :'t2_tx_ref');
select public.settle_dues_payment(:'t1_tx_ref', 'FLW-3', 2500000, 'NGN', 'successful', '{}'::jsonb) as r \gset s1_
select public.settle_dues_payment(:'t2_tx_ref', 'FLW-4', 2500000, 'NGN', 'successful', '{}'::jsonb) as r \gset s2_
select pg_temp.check('the first attempt settles the charge', :'s1_r' = 'settled');
select pg_temp.check('the second is recorded but does not re-pay the charge',
  :'s2_r' = 'settled_charge_already_paid');

-- A charge already paid cannot start another payment.
select reason as r from public.start_dues_payment('d2000000-0000-4000-8000-000000000003') \gset closed_
select pg_temp.check('a paid charge cannot be paid again', :'closed_r' = 'charge_not_open');

-- ─── Genuine concurrency ─────────────────────────────────────────────────────
--
-- Stripe: "your fulfill function might be called multiple times, POSSIBLY
-- CONCURRENTLY, for the same Checkout Session." Sequential replay above proves
-- idempotency; this proves the conditional UPDATE actually serialises, which is
-- a different claim. dblink gives a real second backend and therefore a real
-- row lock -- two calls inside one session would share a snapshot and both
-- appear to succeed, which is the same trap CLAUDE.md documents for test:db.

create extension if not exists dblink;

insert into public.dues_charges (id, estate_id, period, membership_id, amount_minor, currency, due_on)
values ('d2000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000002',
        (date_trunc('month', current_date) + interval '3 months')::date,
        'a2000000-0000-4000-8000-000000000005', 750000, 'NGN', current_date + 90);
set test.uid = 'c0000000-0000-4000-8000-000000000005';
select tx_ref from public.start_dues_payment('d2000000-0000-4000-8000-000000000004') \gset race_
-- Through a setting: psql does not interpolate its own variables inside a
-- dollar-quoted block.
select set_config('test.race', :'race_tx_ref', false);

do $$
declare
  v_conn text := 'dbname=' || current_database() || ' host=127.0.0.1 port=' ||
                 current_setting('port') || ' user=postgres';
  v_a text;
  v_b text;
begin
  perform dblink_connect('racer', v_conn);
  -- Both backends settle the same reference. Whichever loses the row lock must
  -- see the winner's committed state and decline to credit again.
  select r into v_a from dblink('racer',
    format('select public.settle_dues_payment(%L, %L, 750000, %L, %L, %L)',
           current_setting('test.race'), 'FLW-R1', 'NGN', 'successful', '{}')) as t(r text);
  v_b := public.settle_dues_payment(current_setting('test.race'), 'FLW-R2',
                                    750000, 'NGN', 'successful', '{}'::jsonb);
  perform dblink_disconnect('racer');

  if (v_a = 'settled') <> (v_b = 'settled') then
    raise notice 'PASS  concurrent settlement credits exactly once (%, %)', v_a, v_b;
  else
    raise exception 'FAIL  concurrent settlement gave % and %', v_a, v_b;
  end if;
end $$;

select pg_temp.check('the raced charge is paid exactly once', (
  select status = 'paid' from public.dues_charges
   where id = 'd2000000-0000-4000-8000-000000000004'));

-- ─── Privilege ───────────────────────────────────────────────────────────────

select pg_temp.check('settlement is not callable by a signed-in user', (
  select not has_function_privilege('authenticated',
    'public.settle_dues_payment(text,text,bigint,text,text,jsonb)', 'execute')));

select pg_temp.check('the pay-by-token path is service-role only', (
  select not has_function_privilege('authenticated',
    'public.start_dues_payment_by_token(text,text)', 'execute')));

select pg_temp.check('charge generation is not callable by a signed-in user', (
  select not has_function_privilege('authenticated',
    'public.generate_dues_charges(date)', 'execute')));

-- Flutterwave's verify response carries card.token, a live credential that can
-- charge the customer again. It must not be readable by a resident -- which in
-- a per-house estate means every tenant in the building.
select pg_temp.check('raw provider payloads are not readable by residents', (
  select not has_column_privilege('authenticated', 'public.dues_payments', 'raw_payload', 'select')));

select pg_temp.check('...but the amount and status are', (
  select has_column_privilege('authenticated', 'public.dues_payments', 'amount_minor', 'select')
     and has_column_privilege('authenticated', 'public.dues_payments', 'status', 'select')));

select pg_temp.check('a payer''s email is not readable by other residents', (
  select not has_column_privilege('authenticated', 'public.dues_payments', 'payer_email', 'select')));

-- ─── Arrears must never block paying ─────────────────────────────────────────
--
-- Every US product surveyed ships "enforcement" that works the wrong way round:
-- Vantaca blockPayments, CINC BlockPaymentsFlag, PayHOA Lock Account ("will not
-- be able to see any balance... or checkout page"), AppFolio ("won't be able to
-- submit any new payments"). They make it HARDER for a delinquent owner to
-- settle, which is perverse and, in South Africa, hands a resident the
-- strongest possible answer to an arrears complaint.
--
-- Being in arrears here restricts exactly one thing -- minting -- and nothing
-- about the path to fixing it.

insert into public.dues_charges (id, estate_id, period, membership_id, amount_minor, currency, due_on)
values ('cc200000-0000-4000-8000-00000000000f', 'e2000000-0000-4000-8000-000000000002',
        (date_trunc('month', current_date) - interval '3 months')::date,
        'a2000000-0000-4000-8000-000000000005', 750000, 'NGN', current_date - 60);

select pg_temp.check('this resident is genuinely in arrears', (
  select public.dues_in_arrears('a2000000-0000-4000-8000-000000000005')));

set test.uid = 'c0000000-0000-4000-8000-000000000005';
select ok as o, reason as r from public.start_dues_payment('cc200000-0000-4000-8000-00000000000f') \gset arr_
select pg_temp.check('...and can still start a payment', :'arr_o');

select result as r from public.mint_access_code('e2000000-0000-4000-8000-000000000002') \gset arrmint_
select pg_temp.check('...while minting stays blocked', :'arrmint_r' = 'dues_unpaid');

-- ─── A realistic provider payload ────────────────────────────────────────────
--
-- The shape Flutterwave actually returns, so the jsonb column and the amount
-- extraction are exercised against real data rather than '{}'. charged_amount
-- is in MAJOR units and decimal -- the conversion to integer minor units
-- happens in the Edge Function, and 25000.07 * 100 is 2500006.9999999995 in
-- binary floating point, which is why it goes via a rounded string.

set test.uid = 'c0000000-0000-4000-8000-000000000005';
select tx_ref from public.start_dues_payment('cc200000-0000-4000-8000-00000000000f') \gset real_

select public.settle_dues_payment(
  :'real_tx_ref', '8742901', 750000, 'NGN', 'successful',
  jsonb_build_object(
    'id', 8742901, 'tx_ref', :'real_tx_ref', 'flw_ref', 'FLW-MOCK-a1b2c3',
    'amount', 7500, 'charged_amount', 7500, 'currency', 'NGN',
    'app_fee', 105, 'merchant_fee', 0, 'status', 'successful',
    'payment_type', 'card', 'processor_response', 'Approved',
    'created_at', '2026-09-27T10:04:11.000Z',
    -- card.token is redacted in the Edge Function before it ever reaches here.
    'card', jsonb_build_object('first_6digits','553188','last_4digits','2950',
                               'issuer','MASTERCARD','country','NG','type','MASTERCARD'),
    'customer', jsonb_build_object('id', 991, 'email','efe@example.com'))
) as r \gset realr_

select pg_temp.check('a realistic payload settles', :'realr_r' = 'settled');

select pg_temp.check('the stored payload keeps what support needs', (
  select raw_payload->'card'->>'last_4digits' = '2950'
     and raw_payload->>'flw_ref' = 'FLW-MOCK-a1b2c3'
  from public.dues_payments where tx_ref = :'real_tx_ref'));

-- This resident has TWO overdue charges by now. Settling one must NOT clear
-- them, because the test is "any charge past its due date", not "the most
-- recent one". Clearing on a single payment is how a resident pays one month
-- and quietly writes off the rest.
select pg_temp.check('settling one of two arrears does not unblock', (
  select public.dues_in_arrears('a2000000-0000-4000-8000-000000000005')));

update public.dues_charges set status = 'paid', paid_at = now()
 where membership_id = 'a2000000-0000-4000-8000-000000000005' and status = 'open';
select pg_temp.check('clearing every arrear unblocks minting', (
  select not public.dues_in_arrears('a2000000-0000-4000-8000-000000000005')));

-- ─── The pay token has to survive a URL ──────────────────────────────────────
--
-- It exists to be emailed to a landlord as a query parameter. Standard base64
-- emits '+' and '/', and '+' decodes as a space -- so a plain-base64 token
-- would work in testing and fail for roughly one link in four in the wild,
-- which is the worst possible failure shape.

select pg_temp.check('every pay token is URL-safe', (
  select bool_and(pay_token ~ '^[A-Za-z0-9_-]+$') from public.dues_charges));

select pg_temp.check('tokens are long enough to be unguessable', (
  select bool_and(char_length(pay_token) >= 24) from public.dues_charges));

select pg_temp.check('tokens are unique', (
  select count(distinct pay_token) = count(*) from public.dues_charges));

-- ─── Reconciliation is scheduled and closed ──────────────────────────────────

select pg_temp.check('the reconciliation tick is scheduled', (
  select count(*) = 1 from cron.job where jobname = 'dues-reconcile'));

select pg_temp.check('...and is not callable by a signed-in user', (
  select not has_function_privilege('authenticated', 'public.dues_reconcile_tick()', 'execute')));

-- Missing secrets must WARN, not raise: a raise on a schedule fills the cron
-- log with identical failures and tells nobody, and nothing is lost by
-- skipping a tick.
do $$
begin
  perform public.dues_reconcile_tick();
  raise notice 'PASS  a tick with no vault secrets warns rather than raising';
exception when others then
  raise exception 'FAIL  dues_reconcile_tick raised with no secrets: %', sqlerrm;
end $$;

-- The arrears predicate must not be callable by anyone. It answers a financial
-- question about a named person from an id the app handles openly.
select pg_temp.check('the arrears predicate is not callable by anon', (
  select not has_function_privilege('anon', 'public.dues_in_arrears(uuid)', 'execute')));
select pg_temp.check('...nor by a signed-in user', (
  select not has_function_privilege('authenticated', 'public.dues_in_arrears(uuid)', 'execute')));

-- ─── Who does a resident chase? ──────────────────────────────────────────────
--
-- "Your dues are unpaid" is useless to a tenant in a house-billed estate: they
-- cannot settle a bill they were never given. The app must be able to say who
-- to call, so my_dues carries the landlord on a house charge.

set test.uid = 'c0000000-0000-4000-8000-000000000001';
select billing_mode as m, landlord_email as le, subject as s
  from public.my_dues('e2000000-0000-4000-8000-000000000001') limit 1 \gset ll_

select pg_temp.check('a house charge reports the per_house mode', :'ll_m' = 'per_house');
select pg_temp.check('...and carries the landlord to contact', :'ll_le' = 'landlord@example.com');
select pg_temp.check('...and is labelled as a house charge', :'ll_s' = 'house');

-- A resident-billed estate has no landlord in the arrangement, and must not
-- invent one.
set test.uid = 'c0000000-0000-4000-8000-000000000004';
-- coalesce, because psql UNSETS a variable when the column is NULL rather than
-- setting it empty -- so an unguarded :'rr_le' is left unsubstituted and the
-- statement fails to parse.
select billing_mode as m, coalesce(landlord_email, '') as le, subject as s
  from public.my_dues('e2000000-0000-4000-8000-000000000002') limit 1 \gset rr_

select pg_temp.check('a resident charge reports the per_resident mode', :'rr_m' = 'per_resident');
select pg_temp.check('...and carries no landlord', :'rr_le' = '');
select pg_temp.check('...and is labelled as a resident charge', :'rr_s' = 'resident');

-- A house with no landlord recorded must still return the charge. The app
-- branches on the mode, not on the contact being present, and falls back to
-- the estate office.
set test.uid = 'c0000000-0000-4000-8000-000000000003';
select count(*) as n from public.my_dues('e2000000-0000-4000-8000-000000000001') \gset nolord_
select pg_temp.check('a house with no landlord on record still returns its charges', :nolord_n > 0);

-- A resident of one estate must not see another estate's dues through it.
do $$
begin
  perform * from public.my_dues('e2000000-0000-4000-8000-000000000002');
  raise exception 'FAIL  a non-resident read another estate''s dues';
exception when insufficient_privilege then
  raise notice 'PASS  my_dues refuses an estate you do not live at';
end $$;

reset test.uid;

-- ─── Configuring dues ────────────────────────────────────────────────────────

set test.uid = 'c0000000-0000-4000-8000-000000000001';
do $$
begin
  perform public.set_dues_config('e2000000-0000-4000-8000-000000000001', 'per_resident', 100000, 'NGN');
  raise exception 'FAIL  a resident reconfigured their estate''s dues';
exception when insufficient_privilege then
  raise notice 'PASS  only an admin may configure dues';
end $$;

set test.uid = 'c0000000-0000-4000-8000-00000000000a';
do $$
begin
  perform public.set_dues_config('e2000000-0000-4000-8000-000000000001', 'per_house', null, 'NGN');
  raise exception 'FAIL  a billing mode with no amount was accepted';
exception when sqlstate '22023' then
  raise notice 'PASS  a billing mode needs an amount';
end $$;

do $$
begin
  perform public.set_dues_config('e2000000-0000-4000-8000-000000000001', 'per_house', 100000, 'USD');
  raise exception 'FAIL  an unsupported currency was accepted';
exception when sqlstate '22023' then
  raise notice 'PASS  an unsupported currency is refused';
end $$;

select public.set_dues_config('e2000000-0000-4000-8000-000000000001', 'per_house', 3000000, 'NGN', 10);
select pg_temp.check('the configuration is saved', (
  select dues_billing_mode = 'per_house' and dues_amount_minor = 3000000
     and dues_currency = 'NGN' and dues_grace_days = 10
  from public.estates where id = 'e2000000-0000-4000-8000-000000000001'));

-- Switching off must clear the money. A stale amount left behind would
-- reappear silently if billing were switched on again months later, at a rate
-- nobody agreed to.
select public.set_dues_config('e2000000-0000-4000-8000-000000000001', 'none');
select pg_temp.check('switching billing off clears the amount', (
  select dues_amount_minor is null and dues_currency is null
  from public.estates where id = 'e2000000-0000-4000-8000-000000000001'));

-- ...and with billing off, nobody is in arrears whatever they owed before.
select pg_temp.check('no billing mode means nobody is blocked', (
  select not public.dues_in_arrears('a2000000-0000-4000-8000-000000000001')));

select public.set_dues_config('e2000000-0000-4000-8000-000000000001', 'per_house', 2500000, 'NGN', 7);

-- Raising the first month on demand: an estate configured on the 8th would
-- otherwise show nothing until the 1st, which reads as "it is not working".
select public.raise_current_dues('e2000000-0000-4000-8000-000000000001') as n \gset first_
select pg_temp.check('raising the current month is idempotent', (
  select public.raise_current_dues('e2000000-0000-4000-8000-000000000001') = 0));

-- ─── Reminders ───────────────────────────────────────────────────────────────

-- A fresh house charge, due in exactly 7 days, at a house that has BOTH a
-- landlord on record and two residents living in it.
insert into public.dues_charges (id, estate_id, period, house_id, amount_minor, currency, due_on)
values ('cc200000-0000-4000-8000-0000000000aa', 'e2000000-0000-4000-8000-000000000001',
        (date_trunc('month', current_date) + interval '6 months')::date,
        'f2000000-0000-4000-8000-000000000001', 2500000, 'NGN', current_date + 7);

-- Both sides are told. The landlord has to pay it and the tenants are the ones
-- who get locked out; telling only one of them is how this becomes an argument
-- at a gate.
select public.send_due_dues_reminders() as n \gset rem_
select pg_temp.check('a charge due in 7 days reminds the landlord and both residents', :rem_n = 3);

select pg_temp.check('the landlord was written to', (
  select count(*) = 1 from public.dues_reminders
   where charge_id = 'cc200000-0000-4000-8000-0000000000aa'
     and recipient = 'landlord' and sent_to = 'landlord@example.com'));

select pg_temp.check('both residents of the house were written to', (
  select count(*) = 2 from public.dues_reminders
   where charge_id = 'cc200000-0000-4000-8000-0000000000aa' and recipient = 'resident'));

-- THE idempotency property. The sweep runs daily and must not re-send.
select public.send_due_dues_reminders() as n \gset rem2_
select pg_temp.check('running the sweep again sends nothing', :rem2_n = 0);

-- Only the landlord gets a payment link. A bearer link in a tenant's inbox is
-- somebody else's bill.
select pg_temp.check('only the landlord is sent a pay link', (
  select count(*) filter (where message->>'pay_token' is not null) = 1
     and count(*) filter (where message->>'pay_token' is null) = 2
  from pgmq.sent where message->>'charge_id' = 'cc200000-0000-4000-8000-0000000000aa'));

-- Two days out is a SECOND reminder, not a duplicate of the first.
update public.dues_charges set due_on = current_date + 2
 where id = 'cc200000-0000-4000-8000-0000000000aa';
select public.send_due_dues_reminders() as n \gset rem3_
select pg_temp.check('the two-day reminder is sent as well', :rem3_n = 3);
select pg_temp.check('...and is recorded as its own kind', (
  select count(distinct kind) = 2 from public.dues_reminders
   where charge_id = 'cc200000-0000-4000-8000-0000000000aa'));

-- Never chase a settled bill.
update public.dues_charges set status = 'paid', paid_at = now()
 where id = 'cc200000-0000-4000-8000-0000000000aa';
update public.dues_charges set due_on = current_date + 7
 where id = 'cc200000-0000-4000-8000-0000000000aa';
select public.send_due_dues_reminders() as n \gset rem4_
select pg_temp.check('a paid charge is never chased', :rem4_n = 0);

-- ─── The admin button ────────────────────────────────────────────────────────

insert into public.dues_charges (id, estate_id, period, house_id, amount_minor, currency, due_on)
values ('cc200000-0000-4000-8000-0000000000bb', 'e2000000-0000-4000-8000-000000000001',
        (date_trunc('month', current_date) + interval '7 months')::date,
        'f2000000-0000-4000-8000-000000000001', 2500000, 'NGN', current_date + 20);

set test.uid = 'c0000000-0000-4000-8000-000000000001';
do $$
begin
  perform public.remind_dues_charge('cc200000-0000-4000-8000-0000000000bb');
  raise exception 'FAIL  a resident sent a dues reminder';
exception when insufficient_privilege then
  raise notice 'PASS  only an admin may send a reminder';
end $$;

set test.uid = 'c0000000-0000-4000-8000-00000000000a';
select public.remind_dues_charge('cc200000-0000-4000-8000-0000000000bb') as n \gset man_
select pg_temp.check('an admin can nudge on demand', :man_n = 3);

select pg_temp.check('a manual nudge records who sent it', (
  select bool_and(sent_by_membership_id = 'a2000000-0000-4000-8000-00000000000a')
  from public.dues_reminders
   where charge_id = 'cc200000-0000-4000-8000-0000000000bb' and kind = 'manual'));

-- Unlike the scheduled ones, a second deliberate nudge a week later is a
-- legitimate thing for an admin to do, so 'manual' is exempt from the
-- once-per-kind index.
select public.remind_dues_charge('cc200000-0000-4000-8000-0000000000bb') as n \gset man2_
select pg_temp.check('an admin may nudge more than once', :man2_n = 3);

-- A resident-billed charge reminds the resident and nobody else -- there is no
-- landlord in that arrangement.
insert into public.dues_charges (id, estate_id, period, membership_id, amount_minor, currency, due_on)
values ('cc200000-0000-4000-8000-0000000000cc', 'e2000000-0000-4000-8000-000000000002',
        (date_trunc('month', current_date) + interval '8 months')::date,
        'a2000000-0000-4000-8000-000000000004', 750000, 'NGN', current_date + 7);

set test.uid = 'c0000000-0000-4000-8000-00000000000a';
select public.remind_dues_charge('cc200000-0000-4000-8000-0000000000cc') as n \gset res_
select pg_temp.check('a resident-billed charge reminds one person', :res_n = 1);
select pg_temp.check('...and that person is the resident, with no pay link', (
  select recipient = 'resident' from public.dues_reminders
   where charge_id = 'cc200000-0000-4000-8000-0000000000cc' limit 1));

reset test.uid;

-- ─── Does the app know whether arrears actually BLOCK this resident? ─────────
--
-- Added after a real report: a resident with overdue dues pressed Generate, was
-- refused, and saw "Could not generate a code. Please try again." Trying again
-- could never have worked, and nothing before that moment said anything was
-- owed.
--
-- The app was not at fault -- my_dues did not tell it whether the estate
-- enforces arrears, so it could not distinguish "you owe money, codes still
-- work" from "codes are paused until you pay". Those need different words, and
-- saying the wrong one is either a lie or a dead end.

-- Estate 1 authorised enforcement earlier in this file; estate 2 did too. Turn
-- estate 2 back off so both states are covered rather than assumed.
set test.uid = 'c0000000-0000-4000-8000-00000000000a';
select public.set_dues_enforcement('e2000000-0000-4000-8000-000000000002', false);

set test.uid = 'c0000000-0000-4000-8000-000000000001';
select enforcement_on as e, is_overdue as o
  from public.my_dues('e2000000-0000-4000-8000-000000000001') limit 1 \gset on_

select pg_temp.check('my_dues reports enforcement ON where the estate authorised it',
  :'on_e' = 't');

set test.uid = 'c0000000-0000-4000-8000-000000000004';
select enforcement_on as e
  from public.my_dues('e2000000-0000-4000-8000-000000000002') limit 1 \gset off_

select pg_temp.check('...and OFF where it did not', :'off_e' = 'f');

-- The flag has to agree with the gate, or the app tells a resident one thing
-- and mint_access_code does another -- which is exactly the mismatch that
-- produced an unexplained refusal.
set test.uid = 'c0000000-0000-4000-8000-000000000001';
select pg_temp.check('the flag agrees with what the gate actually does', (
  select (:'on_e' = 't' and :'on_o' = 't')
     =  public.dues_in_arrears('a2000000-0000-4000-8000-000000000001')));

-- Restore, so anything appended after this sees the state the file set up.
set test.uid = 'c0000000-0000-4000-8000-00000000000a';
select public.set_dues_enforcement('e2000000-0000-4000-8000-000000000002', true, 'House rules 7(b)');

-- ─── The Dues tab's opening numbers ──────────────────────────────────────────
--
-- my_dues_summary exists for one case my_dues cannot serve: an estate that
-- bills but has not raised charges yet returns ZERO ROWS, and a list-only
-- screen would render "nothing here" to a resident who owes money from the
-- 1st. That is the same class of silence that produced the "could not generate
-- a code" dead end, so it gets its own assertions rather than trust.

set test.uid = 'c0000000-0000-4000-8000-000000000001';
select billing_mode as bm, monthly_minor as mm, currency as cur, enforcement_on as en,
       outstanding_minor as out, overdue_minor as ovm, overdue_count as ovc,
       blocked as blk, coalesce(next_period::text,'') as np,
       coalesce(next_due_on::text,'') as nd
  from public.my_dues_summary('e2000000-0000-4000-8000-000000000001') \gset s1_

select pg_temp.check('the summary carries the estate''s own terms',
  :'s1_bm' = 'per_house' and :'s1_mm' = '2500000' and :'s1_cur' = 'NGN' and :'s1_en' = 't');

select pg_temp.check('what is outstanding matches the open charges', (
  select :'s1_out'::bigint = coalesce(sum(c.amount_minor), 0)
    from public.dues_charges c
   where c.estate_id = 'e2000000-0000-4000-8000-000000000001'
     and c.house_id = 'f2000000-0000-4000-8000-000000000001'
     and c.status = 'open'));

-- The number the gate acts on. If this disagreed with dues_in_arrears the tab
-- would tell a resident one thing while the Generate button did another --
-- which is exactly the mismatch this whole area has already produced once.
select pg_temp.check('"blocked" agrees with the gate itself',
  (:'s1_blk' = 't') = public.dues_in_arrears('a2000000-0000-4000-8000-000000000001'));

select pg_temp.check('the next unbilled month is in the future, due after grace',
  :'s1_np' <> '' and :'s1_np'::date > current_date - interval '1 month'
  and :'s1_nd'::date = :'s1_np'::date + 7);

-- ★ THE CASE IT EXISTS FOR ★
--
-- Dues configured, not one charge raised. my_dues gives nothing; the summary
-- must still state the terms, or the screen says "you owe nothing" to someone
-- who is about to owe ₦9,000.
-- Configured by UPDATE rather than through set_dues_config: this estate has no
-- admin fixture and no settlement account, and both are set_dues_config's
-- business, not this test's. Settlement columns included because
-- estates_dues_need_settlement_ck makes billing-with-nowhere-to-settle
-- unrepresentable -- which is the constraint doing its job.
update public.estates set
  dues_billing_mode = 'per_resident', dues_amount_minor = 900000,
  dues_currency = 'NGN', dues_grace_days = 5,
  settlement_country = 'NG', settlement_bank_code = '044',
  settlement_bank_name = 'Access Bank', settlement_account_number = '0690000032',
  settlement_account_name = 'Free Estate Residents Association',
  settlement_account_verified = true,
  settlement_subaccount_ref = 'RS_FREEESTATE000000000000000001',
  settlement_subaccount_id = '90003', settlement_verified_at = now()
 where id = 'e2000000-0000-4000-8000-000000000003';

set test.uid = 'c0000000-0000-4000-8000-000000000006';
select count(*) as n from public.my_dues('e2000000-0000-4000-8000-000000000003') \gset nocharge_
select pg_temp.check('...my_dues has nothing to say here', :'nocharge_n'::int = 0);

select billing_mode as bm, monthly_minor as mm, outstanding_minor as out,
       blocked as blk, coalesce(next_period::text,'') as np, coalesce(next_due_on::text,'') as nd
  from public.my_dues_summary('e2000000-0000-4000-8000-000000000003') \gset s3_

select pg_temp.check('...but the summary still states the terms',
  :'s3_bm' = 'per_resident' and :'s3_mm' = '900000');
select pg_temp.check('...owes nothing yet, and is not blocked',
  :'s3_out'::bigint = 0 and :'s3_blk' = 'f');
select pg_temp.check('...and names the month about to be billed',
  :'s3_np'::date = date_trunc('month', current_date)::date
  and :'s3_nd'::date = date_trunc('month', current_date)::date + 5);

-- An estate that does not bill at all still gets a row, with no next date to
-- show. A screen must never have to ask "did I get a row" before it can speak.
update public.estates set dues_billing_mode = 'none',
  dues_amount_minor = null, dues_currency = null
 where id = 'e2000000-0000-4000-8000-000000000003';

set test.uid = 'c0000000-0000-4000-8000-000000000006';
select billing_mode as bm, coalesce(next_period::text,'-') as np, blocked as blk
  from public.my_dues_summary('e2000000-0000-4000-8000-000000000003') \gset s4_

select pg_temp.check('an estate that does not bill still returns exactly one row',
  :'s4_bm' = 'none' and :'s4_np' = '-' and :'s4_blk' = 'f');

-- Same tenancy rule as everything else here.
do $$
begin
  perform * from public.my_dues_summary('e2000000-0000-4000-8000-000000000001');
  raise exception 'FAIL  the summary leaked another estate';
exception when sqlstate '42501' then
  raise notice 'PASS  the summary refuses an estate you do not live at';
end $$;
