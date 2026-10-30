-- Nigeria only (20261030160000): dues in naira, payouts to Nigerian accounts.
--
-- Runs after detail-views.sql and reuses its fixtures: Estate A (admin a1)
-- bills in NGN into a Nigerian payout account. The officer grade's removal is
-- checked in guard-licence.sql, next to the rest of the licence.

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

-- ─── The rules no longer name ZA or ZAR ──────────────────────────────────────

select pg_temp.check('no constraint allows ZA or ZAR', (
  select count(*) = 0 from pg_constraint
   where connamespace = 'public'::regnamespace
     and pg_get_constraintdef(oid) ~ '''ZAR?'''));

select pg_temp.check('no function body accepts ZA or ZAR', (
  select count(*) = 0
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosrc ~ '''ZAR?'''));

-- Replaced functions keep their grants: set_dues_config is the admin's own
-- call; set_estate_settlement only the edge function's, on the service role.
select pg_temp.check('grants survived the replace', (
  has_function_privilege('authenticated', 'public.set_dues_config(uuid, public.dues_billing_mode, bigint, text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.set_dues_config(uuid, public.dues_billing_mode, bigint, text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_estate_settlement(uuid, text, text, text, text, text, boolean, text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_estate_settlement(uuid, text, text, text, text, text, boolean, text, text, uuid)', 'execute')));

-- ─── Dues: naira only ────────────────────────────────────────────────────────

set test.uid = 'c9000000-0000-4000-8000-0000000000a1';
select pg_temp.raises('an estate cannot bill in rand',
  $$select public.set_dues_config('e9000000-0000-4000-8000-00000000000a', 'per_house', 2500000, 'ZAR', 7)$$,
  'unsupported_currency');
select pg_temp.raises('...nor with no currency at all',
  $$select public.set_dues_config('e9000000-0000-4000-8000-00000000000a', 'per_house', 2500000, null, 7)$$,
  'unsupported_currency');

select public.set_dues_config('e9000000-0000-4000-8000-00000000000a', 'per_house', 2600000, 'NGN', 7);
select pg_temp.check('naira billing still saves', (
  select dues_currency = 'NGN' and dues_amount_minor = 2600000
    from public.estates where id = 'e9000000-0000-4000-8000-00000000000a'));
reset test.uid;

-- The table rules hold even for a write that skips the RPC.
select pg_temp.raises('the estate row refuses ZAR',
  $$update public.estates set dues_currency = 'ZAR' where id = 'e9000000-0000-4000-8000-00000000000a'$$,
  'estates_dues_config_ck');
select pg_temp.raises('a charge row refuses ZAR',
  $$update public.dues_charges set currency = 'ZAR'
     where id = (select id from public.dues_charges limit 1)$$,
  'dues_charges_currency_check');

-- ─── Payouts: Nigerian accounts only ─────────────────────────────────────────

select pg_temp.raises('a ZA payout account is refused',
  $$select public.set_estate_settlement('e9000000-0000-4000-8000-00000000000a', 'ZA', 'FNB',
      'First National Bank', '62152854587', 'Estate A RA', false, 'RS_ZA', '1', null)$$,
  'unsupported_country');
select pg_temp.raises('...and the estate row refuses ZA directly',
  $$update public.estates set settlement_country = 'ZA' where id = 'e9000000-0000-4000-8000-00000000000a'$$,
  'estates_settlement_country_ck');

select pg_temp.check('the existing Nigerian payout account is untouched', (
  select settlement_country = 'NG' and settlement_subaccount_ref = 'RS_A9'
    from public.estates where id = 'e9000000-0000-4000-8000-00000000000a'));
