-- Direct-to-estate settlement: invariants.
--
-- The property under test is a single sentence: NO ESTATE CAN EVER BILL A
-- RESIDENT WITHOUT A BANK ACCOUNT OF ITS OWN FOR THE MONEY TO LAND IN. Every
-- check below is a way that could stop being true.
--
-- It matters more than the usual correctness bar because the failure is
-- silent. Flutterwave accepts a charge with a missing or invalid subaccount,
-- returns 200, and issues a payable link; the split simply does not happen and
-- the money settles to the platform. Nothing errors, no webhook differs, no
-- reconciliation sweep notices. The only place the mistake is visible is here.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end $$;

-- Did the statement raise the error we expected, and not some other one? A
-- bare "it threw" passes just as happily when the function does not exist.
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

insert into auth.users (id, email) values
  ('c1000000-0000-4000-8000-00000000000a', 'estateadmin@example.com'),
  ('c1000000-0000-4000-8000-00000000000b', 'otheradmin@example.com'),
  ('c1000000-0000-4000-8000-00000000000c', 'resident@example.com'),
  ('c1000000-0000-4000-8000-00000000000d', 'owner@example.com');

insert into public.profiles (id, full_name) values
  ('c1000000-0000-4000-8000-00000000000a', 'Estate Admin'),
  ('c1000000-0000-4000-8000-00000000000b', 'Other Admin'),
  ('c1000000-0000-4000-8000-00000000000c', 'Resident'),
  ('c1000000-0000-4000-8000-00000000000d', 'Platform Owner');

insert into public.platform_admins (user_id) values ('c1000000-0000-4000-8000-00000000000d');

-- Deliberately created with NO settlement details. Everything starts from the
-- state a real estate starts from.
insert into public.estates (id, name) values
  ('e3000000-0000-4000-8000-000000000001', 'Unconfigured Estate'),
  ('e3000000-0000-4000-8000-000000000002', 'Other Estate');

insert into public.houses (id, estate_id, house_code, house_number, landlord_email) values
  ('f3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'SSS1', '1', 'll@example.com');

insert into public.memberships (id, user_id, estate_id, role, house_id) values
  ('a3000000-0000-4000-8000-00000000000a','c1000000-0000-4000-8000-00000000000a','e3000000-0000-4000-8000-000000000001','admin',null),
  ('a3000000-0000-4000-8000-00000000000b','c1000000-0000-4000-8000-00000000000b','e3000000-0000-4000-8000-000000000002','admin',null),
  ('a3000000-0000-4000-8000-00000000000c','c1000000-0000-4000-8000-00000000000c','e3000000-0000-4000-8000-000000000001','resident','f3000000-0000-4000-8000-000000000001');

-- ─── Positive control ────────────────────────────────────────────────────────
--
-- Without this the refusal tests below are worthless. A previous suite in this
-- repo had two authorisation tests pass for the wrong reason -- SET LOCAL
-- outside a transaction is a no-op, so auth.uid() was null and NOBODY was an
-- admin, which makes "an outsider is refused" true for free. Prove the fixture
-- can establish an identity at all before trusting anything that depends on it.

set test.uid = 'c1000000-0000-4000-8000-00000000000a';
select pg_temp.check('the fixture can establish an identity',
  public.current_membership('e3000000-0000-4000-8000-000000000001', 'admin') is not null);
select pg_temp.check('...and it is estate-specific',
  public.current_membership('e3000000-0000-4000-8000-000000000002', 'admin') is null);

-- ─── ★ The core guarantee ★ ──────────────────────────────────────────────────

select pg_temp.raises(
  'dues cannot be switched on with nowhere to settle',
  $$select public.set_dues_config('e3000000-0000-4000-8000-000000000001','per_house',2500000,'NGN',7)$$,
  'settlement_account_required');

select pg_temp.check('...and the estate is still not billing', (
  select dues_billing_mode = 'none' from public.estates
   where id = 'e3000000-0000-4000-8000-000000000001'));

-- Belt to the function's braces: even a direct UPDATE that bypasses the RPC
-- entirely cannot reach the state. This is the one that survives somebody
-- writing a new code path and forgetting the check.
select pg_temp.raises(
  'a raw UPDATE cannot switch billing on either',
  $$update public.estates set dues_billing_mode = 'per_house',
      dues_amount_minor = 100000, dues_currency = 'NGN'
     where id = 'e3000000-0000-4000-8000-000000000001'$$,
  'estates_dues_need_settlement_ck');

-- ─── Recording a destination ─────────────────────────────────────────────────

select pg_temp.raises(
  'an estate admin cannot record a settlement account directly',
  $$select public.set_estate_settlement(
      'e3000000-0000-4000-8000-000000000001','NG','044','Access Bank',
      '0690000032','Someone Else', true, 'RS_ATTACKERSUBACCOUNT','99999',
      'c1000000-0000-4000-8000-00000000000a')$$,
  'permission denied');

-- The Edge Function's call, made as the owner of the definer function rather
-- than through PostgREST. This is what the service role reaches.
set test.uid = '';
select public.set_estate_settlement(
  'e3000000-0000-4000-8000-000000000001', 'NG', '044', 'Access Bank',
  '0690000032', 'Unconfigured Estate Residents Association', true,
  'RS_REALSUBACCOUNT0000000000000001', '90101',
  'c1000000-0000-4000-8000-00000000000a');

select pg_temp.check('the destination is recorded', (
  select settlement_subaccount_ref = 'RS_REALSUBACCOUNT0000000000000001'
     and settlement_subaccount_id  = '90101'
     and settlement_account_verified
     and settlement_verified_at is not null
    from public.estates where id = 'e3000000-0000-4000-8000-000000000001'));

-- Both ids or neither. One charges, the other verifies; a row with only one is
-- a dead end in whichever direction it is missing.
select pg_temp.raises(
  'a settlement record with only one id is refused',
  $$select public.set_estate_settlement(
      'e3000000-0000-4000-8000-000000000002','NG','044','Access Bank',
      '0690000032','Other Estate', true, 'RS_ONLYONEID', '', null)$$,
  'both_subaccount_ids_required');

select pg_temp.raises(
  'an unsupported country is refused',
  $$select public.set_estate_settlement(
      'e3000000-0000-4000-8000-000000000002','GB','044','Barclays',
      '0690000032','Other Estate', true, 'RS_GB','90102', null)$$,
  'unsupported_country');

-- ─── The audit trail ─────────────────────────────────────────────────────────

select pg_temp.check('setting a destination is recorded as "set"', (
  select action = 'set' and new_subaccount_ref = 'RS_REALSUBACCOUNT0000000000000001'
     and old_subaccount_ref is null
     and changed_by_membership_id = 'a3000000-0000-4000-8000-00000000000a'
    from public.estate_settlement_changes
   where estate_id = 'e3000000-0000-4000-8000-000000000001'));

-- The whole point of the trail: an account number in it is a second copy of a
-- secret with no reason to exist.
select pg_temp.check('the audit trail never holds a full account number', (
  select new_account_mask = '••••••0032'
    from public.estate_settlement_changes
   where estate_id = 'e3000000-0000-4000-8000-000000000001'));

select pg_temp.check('masking handles a short number',
  public.mask_account_number('123') = '•••'
  and public.mask_account_number('1234') = '••••'
  and public.mask_account_number('12345') = '•2345'
  and public.mask_account_number(null) is null);

-- Replacing one. This is the row that answers "when did this become someone
-- else's account", so it has to carry BOTH sides of the change.
set test.uid = '';
select public.set_estate_settlement(
  'e3000000-0000-4000-8000-000000000001', 'NG', '058', 'GTBank',
  '0123456789', 'Unconfigured Estate Residents Association', true,
  'RS_SECONDSUBACCOUNT000000000000001', '90103',
  'c1000000-0000-4000-8000-00000000000a');

select pg_temp.check('replacing a destination records both sides', (
  select action = 'replaced'
     and old_subaccount_ref = 'RS_REALSUBACCOUNT0000000000000001'
     and new_subaccount_ref = 'RS_SECONDSUBACCOUNT000000000000001'
     and old_account_mask = '••••••0032' and new_account_mask = '••••••6789'
     and old_bank_code = '044' and new_bank_code = '058'
    from public.estate_settlement_changes
   where estate_id = 'e3000000-0000-4000-8000-000000000001' and action = 'replaced'));

select pg_temp.check('the trail is append-only, not overwritten', (
  select count(*) = 2 from public.estate_settlement_changes
   where estate_id = 'e3000000-0000-4000-8000-000000000001'));

-- ─── Reading it back ─────────────────────────────────────────────────────────

set test.uid = 'c1000000-0000-4000-8000-00000000000a';
select pg_temp.check('an admin sees the masked account and the resolved name', (
  select account_mask = '••••••6789' and account_name = 'Unconfigured Estate Residents Association'
     and account_verified and bank_name = 'GTBank'
    from public.estate_settlement('e3000000-0000-4000-8000-000000000001')));

set test.uid = 'c1000000-0000-4000-8000-00000000000c';
select pg_temp.raises(
  'a resident cannot read the estate bank account',
  $$select * from public.estate_settlement('e3000000-0000-4000-8000-000000000001')$$,
  'not_an_admin_at_this_estate');

set test.uid = 'c1000000-0000-4000-8000-00000000000b';
select pg_temp.raises(
  'an admin of another estate cannot read it either',
  $$select * from public.estate_settlement('e3000000-0000-4000-8000-000000000001')$$,
  'not_an_admin_at_this_estate');

-- ─── Currency has to match the account ───────────────────────────────────────

set test.uid = 'c1000000-0000-4000-8000-00000000000a';
select pg_temp.raises(
  'a Nigerian account cannot be billed in rand',
  $$select public.set_dues_config('e3000000-0000-4000-8000-000000000001','per_house',250000,'ZAR',7)$$,
  'currency_does_not_match_settlement_account');

-- ─── Now billing is allowed ──────────────────────────────────────────────────

select public.set_dues_config('e3000000-0000-4000-8000-000000000001','per_house',2500000,'NGN',7);
select pg_temp.check('with a destination recorded, dues can be switched on', (
  select dues_billing_mode = 'per_house' from public.estates
   where id = 'e3000000-0000-4000-8000-000000000001'));

-- ─── Taking a destination away ───────────────────────────────────────────────

select pg_temp.raises(
  'the account cannot be removed while residents are being billed',
  $$select public.clear_estate_settlement('e3000000-0000-4000-8000-000000000001')$$,
  'turn_off_dues_first');

-- ─── The split reaches the payment ───────────────────────────────────────────

select public.generate_dues_charges(date_trunc('month', current_date)::date);

set test.uid = 'c1000000-0000-4000-8000-00000000000c';
select ok, subaccount_ref, fee_percent
  from public.start_dues_payment(
    (select id from public.dues_charges
      where estate_id = 'e3000000-0000-4000-8000-000000000001' limit 1)) \gset pay_

select pg_temp.check('starting a payment carries the estate subaccount',
  :'pay_ok' = 't' and :'pay_subaccount_ref' = 'RS_SECONDSUBACCOUNT000000000000001');

select pg_temp.check('...and the commission rate, which defaults to nothing',
  :'pay_fee_percent'::numeric = 0);

-- A charge outlives the configuration that raised it. If the destination is
-- taken away while last month's charges are still open, taking the money is
-- worse than refusing it -- there would be nowhere to send it.
set test.uid = 'c1000000-0000-4000-8000-00000000000a';
select public.set_dues_config('e3000000-0000-4000-8000-000000000001', 'none');
select public.clear_estate_settlement('e3000000-0000-4000-8000-000000000001');

set test.uid = 'c1000000-0000-4000-8000-00000000000c';
select ok, reason from public.start_dues_payment(
  (select id from public.dues_charges
    where estate_id = 'e3000000-0000-4000-8000-000000000001' limit 1)) \gset orphan_

select pg_temp.check('an open charge whose estate lost its account cannot be paid',
  :'orphan_ok' = 'f' and :'orphan_reason' = 'estate_has_no_settlement_account');

select pg_temp.check('...and removing it was recorded', (
  select action = 'cleared' and old_subaccount_ref = 'RS_SECONDSUBACCOUNT000000000000001'
    from public.estate_settlement_changes
   where estate_id = 'e3000000-0000-4000-8000-000000000001' and action = 'cleared'));

-- The landlord's link has to refuse for the same reason. It is a separate
-- function and therefore a separate chance to forget.
set test.uid = '';
select ok, reason from public.start_dues_payment_by_token(
  (select pay_token from public.dues_charges
    where estate_id = 'e3000000-0000-4000-8000-000000000001' limit 1), 'payer@example.com') \gset tok_

select pg_temp.check('the landlord pay link refuses for the same reason',
  :'tok_ok' = 'f' and :'tok_reason' = 'estate_has_no_settlement_account');

-- ─── The commission ──────────────────────────────────────────────────────────

set test.uid = 'c1000000-0000-4000-8000-00000000000a';
select pg_temp.raises(
  'an estate admin cannot set their own estate''s commission',
  $$select public.set_platform_fee('e3000000-0000-4000-8000-000000000001', 0.05)$$,
  'platform_admin_only');

set test.uid = 'c1000000-0000-4000-8000-00000000000d';
select public.set_platform_fee('e3000000-0000-4000-8000-000000000001', 0.05);
select pg_temp.check('the platform owner can set a commission', (
  select platform_fee_percent = 0.05 from public.estates
   where id = 'e3000000-0000-4000-8000-000000000001'));

select pg_temp.raises(
  'a commission above the ceiling is refused',
  $$select public.set_platform_fee('e3000000-0000-4000-8000-000000000001', 0.5)$$,
  'fee_out_of_range');

select pg_temp.raises(
  'a negative commission is refused',
  $$select public.set_platform_fee('e3000000-0000-4000-8000-000000000001', -0.01)$$,
  'fee_out_of_range');

select pg_temp.raises(
  'the ceiling is a table constraint too, not just a function check',
  $$update public.estates set platform_fee_percent = 0.9
     where id = 'e3000000-0000-4000-8000-000000000001'$$,
  'estates_platform_fee_ck');

-- ─── Nobody can forge the audit trail ────────────────────────────────────────

select pg_temp.check('the audit table has RLS on with no write policy', (
  select relrowsecurity from pg_class
   where oid = 'public.estate_settlement_changes'::regclass)
  and not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'estate_settlement_changes'
       and cmd in ('INSERT','UPDATE','DELETE','ALL')));

-- Every definer function added here, checked for the two properties that have
-- caused real bugs in this repo: an unset search_path, and EXECUTE left with
-- the PUBLIC default that makes an RPC anon-callable.
select pg_temp.check('every new definer function pins its search_path', (
  select count(*) = 0 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname in ('set_estate_settlement','clear_estate_settlement',
                       'estate_settlement','set_platform_fee')
     and not coalesce(array_to_string(p.proconfig,',') like '%search_path=%', false)));

select pg_temp.check('the money-destination writer is callable by nobody but the server', (
  select not has_function_privilege('authenticated',
    'public.set_estate_settlement(uuid,text,text,text,text,text,boolean,text,text,uuid)', 'execute')
     and not has_function_privilege('anon',
    'public.set_estate_settlement(uuid,text,text,text,text,text,boolean,text,text,uuid)', 'execute')));

select pg_temp.check('the admin-facing calls are not anon-callable', (
  select not has_function_privilege('anon', 'public.estate_settlement(uuid)', 'execute')
     and not has_function_privilege('anon', 'public.clear_estate_settlement(uuid)', 'execute')
     and not has_function_privilege('anon', 'public.set_platform_fee(uuid,numeric)', 'execute')));

select 'All settlement invariants passed.' as result;
