-- Operator dues ledger: invariants.
--
-- The platform owner sees every dues transaction on the platform. Three things
-- here are load-bearing and are tested rather than reasoned about:
--
--   1. NOBODY ELSE CAN CALL IT. It returns payer emails, phones and card last4
--      across every estate. An estate admin reaching it is a cross-tenant leak.
--   2. COMMISSION IS FROZEN AT CHECKOUT. Changing an estate's rate must not
--      restate what the platform earned last month.
--   3. TOTALS COUNT MONEY THAT MOVED. A failed or abandoned attempt is listed,
--      but never added to what was collected.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end $$;

create or replace function pg_temp.raises(label text, sql text, want text) returns void
language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL  % (expected %, nothing raised)', label, want;
exception
  when others then
    if sqlerrm like '%' || want || '%' then
      raise notice 'PASS  % (%)', label, want;
    else
      raise exception 'FAIL  % (wanted %, got %)', label, want, sqlerrm;
    end if;
end $$;

-- ─── Seed ────────────────────────────────────────────────────────────────────
--
--   Estate A (per_house, 5% fee)     House 1: Rita pays it from the app
--                                    House 2: the landlord pays from the link
--   Estate B (per_resident, 10% fee) Sam's own charge: his card is declined

insert into auth.users (id, email) values
  ('c6000000-0000-4000-8000-00000000000d', 'owner6@example.com'),
  ('c6000000-0000-4000-8000-00000000000a', 'admin6@example.com'),
  ('c6000000-0000-4000-8000-000000000001', 'rita@example.com'),
  ('c6000000-0000-4000-8000-000000000002', 'sam@example.com');

insert into public.profiles (id, full_name, phone) values
  ('c6000000-0000-4000-8000-00000000000d', 'Platform Owner', null),
  ('c6000000-0000-4000-8000-00000000000a', 'Estate Admin', null),
  ('c6000000-0000-4000-8000-000000000001', 'Rita Resident', '+2348000000001'),
  ('c6000000-0000-4000-8000-000000000002', 'Sam Resident', null);

insert into public.platform_admins (user_id) values ('c6000000-0000-4000-8000-00000000000d');

insert into public.estates (id, name, dues_billing_mode, dues_amount_minor, dues_currency,
                            dues_grace_days, settlement_country, settlement_bank_code,
                            settlement_bank_name, settlement_account_number,
                            settlement_account_name, settlement_account_verified,
                            settlement_subaccount_ref, settlement_subaccount_id,
                            settlement_verified_at, platform_fee_percent) values
  ('e6000000-0000-4000-8000-000000000001', 'Acacia Park', 'per_house', 2500000, 'NGN', 7,
   'NG', '044', 'Access Bank', '0690000032', 'Acacia RA', true,
   'RS_ACACIA0000000000000000000001', '90030', now(), 0.05),
  ('e6000000-0000-4000-8000-000000000002', 'Baobab Court', 'per_resident', 1000000, 'NGN', 7,
   'NG', '044', 'Access Bank', '0690000033', 'Baobab RA', true,
   'RS_BAOBAB0000000000000000000001', '90031', now(), 0.10);

insert into public.houses (id, estate_id, house_code, house_number, landlord_name, landlord_email) values
  ('f6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'OP01', '1',
   'Lola Landlord', 'lola@example.com'),
  ('f6000000-0000-4000-8000-000000000002', 'e6000000-0000-4000-8000-000000000001', 'OP02', '2',
   'Kemi Landlord', 'kemi@example.com');

insert into public.memberships (id, user_id, estate_id, role, house_id) values
  ('a6000000-0000-4000-8000-00000000000a','c6000000-0000-4000-8000-00000000000a','e6000000-0000-4000-8000-000000000001','admin',null),
  ('a6000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','resident','f6000000-0000-4000-8000-000000000001'),
  ('a6000000-0000-4000-8000-000000000002','c6000000-0000-4000-8000-000000000002','e6000000-0000-4000-8000-000000000002','resident',null);

select public.generate_dues_charges(date_trunc('month', current_date)::date);

select id as h1 from public.dues_charges where house_id = 'f6000000-0000-4000-8000-000000000001' \gset
select id as h2, pay_token as h2_token from public.dues_charges
 where house_id = 'f6000000-0000-4000-8000-000000000002' \gset
select id as s1 from public.dues_charges
 where membership_id = 'a6000000-0000-4000-8000-000000000002' \gset

-- ─── Payments ────────────────────────────────────────────────────────────────

-- Rita pays house 1 by card. The payload is shaped like Flutterwave's verify
-- response, AFTER redact(): no card.token.
set test.uid = 'c6000000-0000-4000-8000-000000000001';
select tx_ref as rita_ref from public.start_dues_payment(:'h1') \gset
reset test.uid;
select public.settle_dues_payment(:'rita_ref', 'FLW-601', 2500000, 'NGN', 'successful',
  '{"flw_ref":"FLW-MOCK-601","payment_type":"card","charged_amount":25350,
    "app_fee":350.5,"amount_settled":"25000","processor_response":"Approved",
    "customer":{"name":"R. Resident","email":"rita@example.com","phone_number":"+2348099999999"},
    "card":{"type":"MASTERCARD","last_4digits":"4242","issuer":"ACCESS BANK"}}'::jsonb) as r \gset

-- The landlord pays house 2 from the emailed link -- no account, no membership.
select tx_ref as link_ref from public.start_dues_payment_by_token(:'h2_token', 'kemi@example.com') \gset
select public.settle_dues_payment(:'link_ref', 'FLW-602', 2500000, 'NGN', 'successful',
  '{"payment_type":"bank_transfer","charged_amount":"not a number",
    "customer":{"name":"Kemi L","email":"kemi@example.com"}}'::jsonb) as r \gset

-- Sam's card is declined.
set test.uid = 'c6000000-0000-4000-8000-000000000002';
select tx_ref as sam_ref from public.start_dues_payment(:'s1') \gset
reset test.uid;
select public.settle_dues_payment(:'sam_ref', 'FLW-603', 1000000, 'NGN', 'failed',
  '{"processor_response":"Insufficient funds"}'::jsonb) as r \gset

-- Acacia's rate goes up AFTER Rita paid.
update public.estates set platform_fee_percent = 0.20
 where id = 'e6000000-0000-4000-8000-000000000001';

-- ─── Positive control ────────────────────────────────────────────────────────

set test.uid = 'c6000000-0000-4000-8000-00000000000d';
select pg_temp.check('the fixture can establish a platform owner', public.is_platform_admin());

-- ─── ★ 1. Nobody else can call it ★ ──────────────────────────────────────────

set test.uid = 'c6000000-0000-4000-8000-00000000000a';
select pg_temp.raises('an estate admin cannot read the platform ledger',
  $$select * from public.operator_dues_payments()$$, 'not_a_platform_admin');
select pg_temp.raises('...not even filtered to their own estate',
  $$select * from public.operator_dues_payments('e6000000-0000-4000-8000-000000000001')$$,
  'not_a_platform_admin');
select pg_temp.raises('...nor the per-estate totals',
  $$select * from public.operator_dues_by_estate()$$, 'not_a_platform_admin');

set test.uid = 'c6000000-0000-4000-8000-000000000001';
select pg_temp.raises('a resident cannot read it',
  $$select * from public.operator_dues_payments()$$, 'not_a_platform_admin');

reset test.uid;
select pg_temp.raises('a signed-out caller cannot read it',
  $$select * from public.operator_dues_payments()$$, 'not_a_platform_admin');

select pg_temp.check('anon has no EXECUTE on either RPC', (
  not has_function_privilege('anon',
        'public.operator_dues_payments(uuid,timestamptz,timestamptz,integer)', 'execute')
  and not has_function_privilege('anon',
        'public.operator_dues_by_estate(timestamptz,timestamptz)', 'execute')));
select pg_temp.check('the trigger function and payload helper are not callable', (
  not has_function_privilege('authenticated', 'public.stamp_dues_payment_fee()', 'execute')
  and not has_function_privilege('authenticated', 'private.payload_minor(jsonb,text)', 'execute')));

-- ─── The ledger ──────────────────────────────────────────────────────────────

set test.uid = 'c6000000-0000-4000-8000-00000000000d';

select count(*) as n from public.operator_dues_payments() \gset all_
select pg_temp.check('the owner sees every attempt across every estate, failures included',
  :'all_n'::int = 3);

select count(*) as n from public.operator_dues_payments('e6000000-0000-4000-8000-000000000002') \gset b_
select pg_temp.check('the estate filter narrows to that estate', :'b_n'::int = 1);

select count(*) as n from public.operator_dues_payments(null, now() + interval '1 day') \gset fut_
select pg_temp.check('the date window filters on our clock', :'fut_n'::int = 0);

select * from public.operator_dues_payments() where tx_ref = :'rita_ref' \gset rita_
select pg_temp.check('the app payment names the estate, house and payer', (
  :'rita_estate_name' = 'Acacia Park' and :'rita_house_number' = '1'
  and :'rita_payer_name' = 'Rita Resident' and :'rita_paid_via' = 'resident'
  and :'rita_billed_to' = 'house' and :'rita_billed_name' = 'Lola Landlord'));
select pg_temp.check('...prefers the profile phone over the checkout form',
  :'rita_payer_phone' = '+2348000000001');
select pg_temp.check('...and pulls the provider detail out of the payload', (
  :'rita_provider_ref' = 'FLW-MOCK-601' and :'rita_payment_type' = 'card'
  and :'rita_card_brand' = 'MASTERCARD' and :'rita_card_last4' = '4242'
  and :'rita_provider_tx_id' = 'FLW-601' and :'rita_processor_response' = 'Approved'));
select pg_temp.check('payload amounts become MINOR units, number or string', (
  :'rita_charged_minor'::bigint = 2535000 and :'rita_provider_fee_minor'::bigint = 35050
  and :'rita_settled_minor'::bigint = 2500000));

-- ★ 2. Frozen commission ★
select pg_temp.check('commission uses the rate in force at checkout, not today''s', (
  :'rita_platform_fee_percent'::numeric = 0.05
  and :'rita_platform_fee_minor'::bigint = 125000));

select * from public.operator_dues_payments() where tx_ref = :'link_ref' \gset link_
select pg_temp.check('a link payment is marked as one, with the email it was paid under', (
  :'link_paid_via' = 'pay_link' and :'link_payer_email' = 'kemi@example.com'
  and :'link_payer_name' = 'Kemi L'));
-- Checked in SQL, not via \gset: psql leaves a variable UNSET for a NULL.
select pg_temp.check('a malformed payload amount is NULL, not an error', (
  select charged_minor is null from public.operator_dues_payments() where tx_ref = :'link_ref'));

select * from public.operator_dues_payments() where tx_ref = :'sam_ref' \gset sam_
select pg_temp.check('a failed attempt is listed with the reason, and earns no commission', (
  :'sam_status' = 'failed' and :'sam_processor_response' = 'Insufficient funds'
  and :'sam_billed_to' = 'resident' and :'sam_billed_name' = 'Sam Resident'
  and (select platform_fee_minor is null from public.operator_dues_payments()
        where tx_ref = :'sam_ref')));

-- ─── ★ 3. Totals ★ ───────────────────────────────────────────────────────────

select * from public.operator_dues_by_estate()
 where estate_id = 'e6000000-0000-4000-8000-000000000001' \gset a_
select pg_temp.check('Acacia: two payments, both counted, frozen commission summed', (
  :'a_payments'::int = 2 and :'a_collected_minor'::bigint = 5000000
  and :'a_platform_fee_minor'::bigint = 125000 + 125000 and :'a_payers'::int = 2
  and :'a_outstanding_minor'::bigint = 0));

select * from public.operator_dues_by_estate()
 where estate_id = 'e6000000-0000-4000-8000-000000000002' \gset bb_
select pg_temp.check('Baobab: the declined card collected nothing and the charge is still owed', (
  :'bb_payments'::int = 0 and :'bb_failed'::int = 1 and :'bb_collected_minor'::bigint = 0
  and :'bb_outstanding_minor'::bigint = 1000000 and :'bb_open_charges'::int = 1));
