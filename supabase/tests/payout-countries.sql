-- Dues and payout countries (20261126100000): naira into Nigerian accounts,
-- rand into South African ones, and nothing else.
--
-- Runs after detail-views.sql and reuses its fixtures: Estate A (admin a1)
-- bills in NGN into a Nigerian payout account; Estate B (admin b1) is moved to
-- a South African account here and switched to rand.

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

-- ─── The rules name exactly NG/NGN and ZA/ZAR ────────────────────────────────

select pg_temp.check('the currency and country checks allow NGN/ZAR and NG/ZA', (
  select bool_and(case conname
           when 'estates_dues_config_ck'        then pg_get_constraintdef(oid) ~ '''NGN''' and pg_get_constraintdef(oid) ~ '''ZAR'''
           when 'dues_charges_currency_check'   then pg_get_constraintdef(oid) ~ '''NGN''' and pg_get_constraintdef(oid) ~ '''ZAR'''
           when 'estates_settlement_country_ck' then pg_get_constraintdef(oid) ~ '''NG''' and pg_get_constraintdef(oid) ~ '''ZA'''
         end) and count(*) = 3
    from pg_constraint
   where conname in ('estates_dues_config_ck', 'dues_charges_currency_check', 'estates_settlement_country_ck')));

-- Replaced functions keep their grants: set_dues_config is the admin's own
-- call; set_estate_settlement only the edge function's, on the service role.
select pg_temp.check('grants survived the replace', (
  has_function_privilege('authenticated', 'public.set_dues_config(uuid, public.dues_billing_mode, bigint, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.set_dues_config(uuid, public.dues_billing_mode, bigint, text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_estate_settlement(uuid, text, text, text, text, text, boolean, text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_estate_settlement(uuid, text, text, text, text, text, boolean, text, text, uuid)', 'execute')));

-- ─── Payout accounts: Nigerian or South African ──────────────────────────────

-- A South African account: the bank has no name lookup, so it is saved
-- unverified, with the name the admin typed.
select public.set_estate_settlement('e9000000-0000-4000-8000-00000000000b', 'ZA', 'FNB',
  'First National Bank', '62152854587', 'Estate B HOA', false, 'RS_ZA9', '90092', null);
select pg_temp.check('a ZA payout account is accepted, and recorded as unverified', (
  select settlement_country = 'ZA' and settlement_subaccount_ref = 'RS_ZA9'
     and settlement_account_name = 'Estate B HOA' and not settlement_account_verified
    from public.estates where id = 'e9000000-0000-4000-8000-00000000000b'));

select pg_temp.raises('a country the product does not pay into is refused',
  $$select public.set_estate_settlement('e9000000-0000-4000-8000-00000000000a', 'GH', '280100',
      'GCB Bank', '1234567890', 'Estate A', true, 'RS_GH', '1', null)$$,
  'unsupported_country');
select pg_temp.raises('...and the estate row refuses it directly',
  $$update public.estates set settlement_country = 'GH' where id = 'e9000000-0000-4000-8000-00000000000a'$$,
  'estates_settlement_country_ck');

-- ─── Dues: the currency the payout account can receive ───────────────────────

set test.uid = 'c9000000-0000-4000-8000-0000000000b1';
select public.set_dues_config('e9000000-0000-4000-8000-00000000000b', 'per_resident', 75000, 'ZAR', 7);
select pg_temp.check('a South African estate bills in rand', (
  select dues_currency = 'ZAR' and dues_amount_minor = 75000
    from public.estates where id = 'e9000000-0000-4000-8000-00000000000b'));
select pg_temp.raises('...but not in naira into its rand account',
  $$select public.set_dues_config('e9000000-0000-4000-8000-00000000000b', 'per_resident', 75000, 'NGN', 7)$$,
  'currency_does_not_match_settlement_account');
reset test.uid;

set test.uid = 'c9000000-0000-4000-8000-0000000000a1';
select pg_temp.raises('a Nigerian estate cannot bill in rand into its naira account',
  $$select public.set_dues_config('e9000000-0000-4000-8000-00000000000a', 'per_house', 2500000, 'ZAR', 7)$$,
  'currency_does_not_match_settlement_account');
select pg_temp.raises('a currency the product does not collect is refused',
  $$select public.set_dues_config('e9000000-0000-4000-8000-00000000000a', 'per_house', 2500000, 'USD', 7)$$,
  'unsupported_currency');
select pg_temp.raises('...as is no currency at all',
  $$select public.set_dues_config('e9000000-0000-4000-8000-00000000000a', 'per_house', 2500000, null, 7)$$,
  'unsupported_currency');
select public.set_dues_config('e9000000-0000-4000-8000-00000000000a', 'per_house', 2600000, 'NGN', 7);
select pg_temp.check('naira billing still saves for the Nigerian estate', (
  select dues_currency = 'NGN' and dues_amount_minor = 2600000
    from public.estates where id = 'e9000000-0000-4000-8000-00000000000a'));
reset test.uid;

-- The table rules hold even for a write that skips the RPC.
select pg_temp.raises('the estate row refuses an unsupported currency',
  $$update public.estates set dues_currency = 'USD' where id = 'e9000000-0000-4000-8000-00000000000a'$$,
  'estates_dues_config_ck');
select pg_temp.raises('a charge row refuses an unsupported currency',
  $$update public.dues_charges set currency = 'USD' where id = (select id from public.dues_charges limit 1)$$,
  'dues_charges_currency_check');
select id as rand_charge from public.dues_charges limit 1 \gset
update public.dues_charges set currency = 'ZAR' where id = :'rand_charge';
select pg_temp.check('a rand charge row is allowed', (
  select currency = 'ZAR' from public.dues_charges where id = :'rand_charge'));
