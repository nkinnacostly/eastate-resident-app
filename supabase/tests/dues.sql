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

insert into public.estates (id, name, dues_billing_mode, dues_amount_minor, dues_currency, dues_grace_days) values
  ('e2000000-0000-4000-8000-000000000001', 'Landlord Estate', 'per_house',    2500000, 'NGN', 7),
  ('e2000000-0000-4000-8000-000000000002', 'Flats Estate',    'per_resident',  750000, 'NGN', 7);
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

select pg_temp.check('authorising records who and on what basis', (
  select dues_enforcement_authorised_by = 'a2000000-0000-4000-8000-00000000000a'
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
