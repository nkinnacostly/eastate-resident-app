-- Paying dues ahead (1, 3, 6 or 12 months): invariants.
--
-- Money, so the questions are the ones that cost someone if they go wrong:
--   * Is the customer charged exactly N months -- and refused for less?
--   * Does each covered month end up PAID, including months that did not exist
--     yet when they paid -- and does the monthly generator then leave them be?
--   * Is the plan frozen: a rate change or a month raised mid-checkout must not
--     change what was bought?
--   * Is a waived or already-paid month skipped rather than sold twice?

\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end $$;

-- ─── Seed ────────────────────────────────────────────────────────────────────
--
--   Acacia (per_house ₦25,000)   House 1: Rita pays 3 months in the app
--                                House 2: the landlord pays 6 from the link,
--                                         with next month already waived
--   Baobab (per_resident ₦10,000) Sam pays a year; the rate rises mid-checkout
--   Cedar  (per_resident ₦5,000)  dues switched off after billing: no pay-ahead

insert into auth.users (id, email) values
  ('c8000000-0000-4000-8000-000000000001', 'rita8@example.com'),
  ('c8000000-0000-4000-8000-000000000002', 'sam8@example.com'),
  ('c8000000-0000-4000-8000-000000000003', 'cleo8@example.com'),
  ('c8000000-0000-4000-8000-00000000000d', 'owner8@example.com');

insert into public.profiles (id, full_name) values
  ('c8000000-0000-4000-8000-000000000001', 'Rita'),
  ('c8000000-0000-4000-8000-000000000002', 'Sam'),
  ('c8000000-0000-4000-8000-000000000003', 'Cleo'),
  ('c8000000-0000-4000-8000-00000000000d', 'Owner');

insert into public.platform_admins (user_id) values ('c8000000-0000-4000-8000-00000000000d');

insert into public.estates (id, name, dues_billing_mode, dues_amount_minor, dues_currency,
                            dues_grace_days, settlement_country, settlement_bank_code,
                            settlement_bank_name, settlement_account_number,
                            settlement_account_name, settlement_account_verified,
                            settlement_subaccount_ref, settlement_subaccount_id,
                            settlement_verified_at) values
  ('e8000000-0000-4000-8000-000000000001', 'Acacia', 'per_house', 2500000, 'NGN', 7,
   'NG', '044', 'Access Bank', '0690000040', 'Acacia RA', true, 'RS_ACACIA8', '90080', now()),
  ('e8000000-0000-4000-8000-000000000002', 'Baobab', 'per_resident', 1000000, 'NGN', 5,
   'NG', '044', 'Access Bank', '0690000041', 'Baobab RA', true, 'RS_BAOBAB8', '90081', now()),
  ('e8000000-0000-4000-8000-000000000003', 'Cedar', 'per_resident', 500000, 'NGN', 7,
   'NG', '044', 'Access Bank', '0690000042', 'Cedar RA', true, 'RS_CEDAR8', '90082', now());

insert into public.houses (id, estate_id, house_code, house_number, landlord_email) values
  ('f8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'PA01', '1', 'l1@example.com'),
  ('f8000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000001', 'PA02', '2', 'l2@example.com');

insert into public.memberships (id, user_id, estate_id, role, house_id) values
  ('a8000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001','resident','f8000000-0000-4000-8000-000000000001'),
  ('a8000000-0000-4000-8000-000000000002','c8000000-0000-4000-8000-000000000002','e8000000-0000-4000-8000-000000000002','resident',null),
  ('a8000000-0000-4000-8000-000000000003','c8000000-0000-4000-8000-000000000003','e8000000-0000-4000-8000-000000000003','resident',null);

\set m0 '(date_trunc(''month'', current_date)::date)'
select :m0 as m0, (:m0 + interval '1 month')::date as m1, (:m0 + interval '2 months')::date as m2,
       (:m0 + interval '3 months')::date as m3, (:m0 + interval '6 months')::date as m6,
       (:m0 + interval '11 months')::date as m11 \gset

select public.generate_dues_charges(:'m0');

select id as h1 from public.dues_charges where house_id = 'f8000000-0000-4000-8000-000000000001' \gset
select id as h2, pay_token as h2_token from public.dues_charges where house_id = 'f8000000-0000-4000-8000-000000000002' \gset
select id as sam_c from public.dues_charges where membership_id = 'a8000000-0000-4000-8000-000000000002' \gset
select id as cleo_c from public.dues_charges where membership_id = 'a8000000-0000-4000-8000-000000000003' \gset

-- ─── Terms ───────────────────────────────────────────────────────────────────

set test.uid = 'c8000000-0000-4000-8000-000000000001';
select reason as r from public.start_dues_payment(:'h1', 2) \gset bad_
select pg_temp.check('only 1, 3, 6 or 12 months are offered', :'bad_r' = 'invalid_term');

select count(*) as n from public.dues_payments p
  join public.dues_charges c on c.id = p.charge_id where c.id = :'h1' \gset none_
select pg_temp.check('...and a refused term claims no reference', :'none_n'::int = 0);

-- ─── Rita: a quarter, in the app ─────────────────────────────────────────────

select ok, tx_ref, amount_minor as amt, months, covers_from as cf, covers_until as cu
  from public.start_dues_payment(:'h1', 3) \gset q_
select pg_temp.check('a quarter costs exactly three months', (
  :'q_ok' = 't' and :'q_amt'::bigint = 7500000 and :'q_months'::int = 3));
select pg_temp.check('...and says which three', :'q_cf' = :'m0' and :'q_cu' = :'m2');

reset test.uid;
select pg_temp.check('nothing is billed for future months before the money arrives', (
  select count(*) = 1 from public.dues_charges where house_id = 'f8000000-0000-4000-8000-000000000001'));

select public.settle_dues_payment(:'q_tx_ref', 'FLW-801', 2500000, 'NGN', 'successful', '{}') as r \gset short_
select pg_temp.check('one month''s money for a quarter is refused', :'short_r' = 'amount_mismatch');
select pg_temp.check('...and pays nothing', (
  select status = 'open' from public.dues_charges where id = :'h1'));

select public.settle_dues_payment(:'q_tx_ref', 'FLW-801', 7500000, 'NGN', 'successful', '{}') as r \gset full_
select pg_temp.check('the full amount settles', :'full_r' = 'settled');

select pg_temp.check('all three months are now paid charges', (
  select count(*) = 3 and bool_and(status = 'paid') and bool_and(amount_minor = 2500000)
    from public.dues_charges where house_id = 'f8000000-0000-4000-8000-000000000001'));
select pg_temp.check('a future month carries the estate''s due date for that month', (
  select due_on = (:'m2'::date + 7) from public.dues_charges
   where house_id = 'f8000000-0000-4000-8000-000000000001' and period = :'m2'));
select pg_temp.check('the plan records which charge paid for each month', (
  select count(*) = 3 and bool_and(pp.charge_id is not null)
    from public.dues_payment_periods pp join public.dues_payments p on p.id = pp.payment_id
   where p.tx_ref = :'q_tx_ref'));

select public.settle_dues_payment(:'q_tx_ref', 'FLW-801', 7500000, 'NGN', 'successful', '{}') as r \gset again_
select pg_temp.check('a redelivered webhook changes nothing', :'again_r' = 'already_settled' and (
  select count(*) = 3 from public.dues_charges where house_id = 'f8000000-0000-4000-8000-000000000001'));

select public.generate_dues_charges(:'m1');
select pg_temp.check('next month''s billing run leaves the prepaid month paid, not re-billed', (
  select count(*) = 1 and bool_and(status = 'paid') from public.dues_charges
   where house_id = 'f8000000-0000-4000-8000-000000000001' and period = :'m1'));

set test.uid = 'c8000000-0000-4000-8000-000000000001';
select pg_temp.check('the resident''s next payment moves past the prepaid quarter', (
  select next_period = :'m3'::date and outstanding_count = 0
    from public.my_dues_summary('e8000000-0000-4000-8000-000000000001')));
reset test.uid;

-- ─── House 2: the landlord's link, six months, one already waived ────────────

-- next month's run (above) raised house 2's next month; the estate waives it.
update public.dues_charges set status = 'waived', waived_at = now(), waive_reason = 'roof works'
 where house_id = 'f8000000-0000-4000-8000-000000000002' and period = :'m1';

select ok, tx_ref, amount_minor as amt, covers_until as cu
  from public.start_dues_payment_by_token(:'h2_token', 'l2@example.com', 6) \gset l_
select pg_temp.check('six months from the link cost six months', :'l_ok' = 't' and :'l_amt'::bigint = 15000000);
select pg_temp.check('...skipping the waived month rather than selling it', :'l_cu' = :'m6');
select pg_temp.check('...so the plan never includes it', (
  select bool_and(pp.period <> :'m1'::date) from public.dues_payment_periods pp
    join public.dues_payments p on p.id = pp.payment_id where p.tx_ref = :'l_tx_ref'));

select public.settle_dues_payment(:'l_tx_ref', 'FLW-802', 15000000, 'NGN', 'successful', '{}') as r \gset ls_
select pg_temp.check('settled: six paid months and the waiver untouched', :'ls_r' = 'settled' and (
  select count(*) filter (where status = 'paid') = 6
     and count(*) filter (where status = 'waived') = 1
    from public.dues_charges where house_id = 'f8000000-0000-4000-8000-000000000002'));

-- ─── Sam: a year, with the rate rising mid-checkout ──────────────────────────

set test.uid = 'c8000000-0000-4000-8000-000000000002';
select ok, tx_ref, amount_minor as amt, covers_until as cu
  from public.start_dues_payment(:'sam_c', 12) \gset y_
reset test.uid;
select pg_temp.check('a year costs twelve months at today''s rate', (
  :'y_ok' = 't' and :'y_amt'::bigint = 12000000 and :'y_cu' = :'m11'));

-- The estate raises dues, and next month is billed at the new rate, all before
-- Sam's webhook lands.
update public.estates set dues_amount_minor = 2000000 where id = 'e8000000-0000-4000-8000-000000000002';
select public.generate_dues_charges(:'m1');

select public.settle_dues_payment(:'y_tx_ref', 'FLW-803', 12000000, 'NGN', 'successful', '{}') as r \gset ys_
select pg_temp.check('the year settles at the price Sam was quoted', :'ys_r' = 'settled');
select pg_temp.check('...covering twelve paid months, including the one raised meanwhile', (
  select count(*) = 12 and bool_and(status = 'paid')
    from public.dues_charges where membership_id = 'a8000000-0000-4000-8000-000000000002'));
select pg_temp.check('...and the months created by the payment carry the frozen rate', (
  select bool_and(amount_minor = 1000000) from public.dues_charges
   where membership_id = 'a8000000-0000-4000-8000-000000000002' and period > :'m1'::date));

-- ─── Cedar: dues switched off after the month was billed ─────────────────────

update public.estates set dues_billing_mode = 'none' where id = 'e8000000-0000-4000-8000-000000000003';
set test.uid = 'c8000000-0000-4000-8000-000000000003';
select reason as r from public.start_dues_payment(:'cleo_c', 3) \gset off_
select pg_temp.check('months that would never be billed cannot be bought', :'off_r' = 'cannot_pay_ahead');
select ok from public.start_dues_payment(:'cleo_c', 1) \gset one_
select pg_temp.check('...but the month already owed can still be paid', :'one_ok' = 't');
reset test.uid;

-- ─── A payment started before pay-ahead existed ──────────────────────────────

insert into public.dues_charges (id, estate_id, period, membership_id, amount_minor, currency, due_on)
values ('d8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002',
        (:'m0'::date - interval '1 month')::date, 'a8000000-0000-4000-8000-000000000002',
        1000000, 'NGN', current_date);
insert into public.dues_payments (charge_id, tx_ref, amount_minor, currency)
values ('d8000000-0000-4000-8000-000000000001', 'dues-legacy-8', 1000000, 'NGN');
select public.settle_dues_payment('dues-legacy-8', 'FLW-804', 1000000, 'NGN', 'successful', '{}') as r \gset leg_
select pg_temp.check('an in-flight payment from before this change still settles its one charge', (
  :'leg_r' = 'settled' and (select status = 'paid' from public.dues_charges
                             where id = 'd8000000-0000-4000-8000-000000000001')));

-- ─── The ledger says what was covered ────────────────────────────────────────

set test.uid = 'c8000000-0000-4000-8000-00000000000d';
select pg_temp.check('the operator ledger shows the term and the months covered', (
  select months = 12 and covers_from = :'m0'::date and covers_until = :'m11'::date
    from public.operator_dues_payments() where tx_ref = :'y_tx_ref'));
select pg_temp.check('...and a legacy payment shows the one month it paid', (
  select months = 1 and covers_from = covers_until
    from public.operator_dues_payments() where tx_ref = 'dues-legacy-8'));
reset test.uid;

-- ─── Privilege ───────────────────────────────────────────────────────────────

select pg_temp.check('the planning helpers and plan table are not reachable by clients', (
  not has_function_privilege('authenticated', 'private.dues_plan(uuid,integer)', 'execute')
  and not has_function_privilege('authenticated',
        'private.claim_dues_payment(uuid,integer,uuid,text)', 'execute')
  and not has_table_privilege('authenticated', 'public.dues_payment_periods', 'select')
  and not has_function_privilege('anon', 'public.start_dues_payment(uuid,integer)', 'execute')
  and not has_function_privilege('authenticated',
        'public.start_dues_payment_by_token(text,text,integer)', 'execute')));
