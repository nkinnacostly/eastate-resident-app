-- Landlord accounts: invariants.
--
-- A landlord is linked to a house by their CONFIRMED email matching the
-- address the estate recorded. There is no link table and no invitation: the
-- estate's own record is the designation, and a confirmed mailbox is the proof
-- that the person signing in is the person it names.
--
-- That makes two things load-bearing, and both are tested here rather than
-- reasoned about:
--
--   1. AN UNCONFIRMED EMAIL MUST SEE NOTHING. Without that, anyone could sign
--      up claiming a landlord's address and read their property portfolio
--      before ever proving they can receive mail there.
--   2. A LANDLORD MUST NOT SEE THEIR TENANTS' DEBTS. Where a house bills its
--      residents, each resident owes their own dues; what the people living
--      there owe is between them and the estate.

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
-- One landlord (Ada) owning in TWO estates, because owning across estates is
-- the ordinary case and the thing a per-estate model could not express.
--
--   Estate A / House 1  landlord-billed  -> Ada owes this
--   Estate A / House 2  resident-billed  -> Ada owes nothing; her tenant does
--   Estate B / House 3  landlord-billed  -> Ada owes this, other estate
--   Estate A / House 4  belongs to Bode  -> Ada must never see it

insert into auth.users (id, email, email_confirmed_at) values
  ('c5000000-0000-4000-8000-00000000000a', 'ada.landlord@example.com', now()),
  ('c5000000-0000-4000-8000-00000000000b', 'bode.landlord@example.com', now()),
  -- Signed up claiming Ada's address, never confirmed it.
  ('c5000000-0000-4000-8000-00000000000c', 'ada.landlord@example.com', null),
  ('c5000000-0000-4000-8000-000000000001', 'tenant@example.com', now()),
  ('c5000000-0000-4000-8000-00000000000d', 'estateadmin5@example.com', now());

insert into public.profiles (id, full_name) values
  ('c5000000-0000-4000-8000-00000000000a', 'Ada Landlord'),
  ('c5000000-0000-4000-8000-00000000000b', 'Bode Landlord'),
  ('c5000000-0000-4000-8000-00000000000c', 'Impostor'),
  ('c5000000-0000-4000-8000-000000000001', 'Tenant'),
  ('c5000000-0000-4000-8000-00000000000d', 'Estate Admin 5');

insert into public.estates (id, name, dues_billing_mode, dues_amount_minor, dues_currency,
                            dues_grace_days, settlement_country, settlement_bank_code,
                            settlement_bank_name, settlement_account_number,
                            settlement_account_name, settlement_account_verified,
                            settlement_subaccount_ref, settlement_subaccount_id,
                            settlement_verified_at) values
  ('e5000000-0000-4000-8000-000000000001', 'Estate A', 'per_house', 2500000, 'NGN', 7,
   'NG', '044', 'Access Bank', '0690000032', 'Estate A RA', true,
   'RS_ESTATEA00000000000000000001', '90020', now()),
  ('e5000000-0000-4000-8000-000000000002', 'Estate B', 'per_house', 1000000, 'NGN', 7,
   'NG', '044', 'Access Bank', '0690000033', 'Estate B RA', true,
   'RS_ESTATEB00000000000000000001', '90021', now());

insert into public.houses (id, estate_id, house_code, house_number, landlord_email,
                           dues_payer, dues_amount_minor) values
  ('f5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'LL01', '1',
   'ada.landlord@example.com', null, null),
  ('f5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001', 'LL02', '2',
   'Ada.Landlord@Example.com', 'residents', 500000),
  ('f5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000002', 'LL03', '3',
   'ada.landlord@example.com', null, null),
  ('f5000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000001', 'LL04', '4',
   'bode.landlord@example.com', null, null);

insert into public.memberships (id, user_id, estate_id, role, house_id) values
  ('a5000000-0000-4000-8000-00000000000d','c5000000-0000-4000-8000-00000000000d','e5000000-0000-4000-8000-000000000001','admin',null),
  ('a5000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','resident','f5000000-0000-4000-8000-000000000002');

select public.generate_dues_charges(date_trunc('month', current_date)::date);

-- ─── Positive control ────────────────────────────────────────────────────────
--
-- Everything below is a refusal test of some kind, and a refusal passes for
-- free if the fixture cannot establish an identity at all. Prove it can first.

set test.uid = 'c5000000-0000-4000-8000-00000000000a';
select pg_temp.check('the fixture can establish a confirmed landlord',
  public.is_landlord());

-- ★ THE ONE THAT MATTERS MOST ★
set test.uid = 'c5000000-0000-4000-8000-00000000000c';
select pg_temp.check('an UNCONFIRMED account claiming the same address is not a landlord',
  not public.is_landlord());
select count(*) as n from public.my_landlord_houses() \gset imp_
select pg_temp.check('...and sees no houses at all', :'imp_n'::int = 0);
select count(*) as n from public.landlord_dues() \gset impd_
select pg_temp.check('...and no charges at all', :'impd_n'::int = 0);

set test.uid = 'c5000000-0000-4000-8000-000000000001';
select pg_temp.check('a tenant is not a landlord', not public.is_landlord());

-- ─── The portfolio ───────────────────────────────────────────────────────────

set test.uid = 'c5000000-0000-4000-8000-00000000000a';
select count(*) as n from public.my_landlord_houses() \gset p_
select pg_temp.check('a landlord sees every house they own, across estates', :'p_n'::int = 3);

select count(distinct estate_id) as n from public.my_landlord_houses() \gset pe_
select pg_temp.check('...spanning both estates, without choosing one first', :'pe_n'::int = 2);

-- The address was recorded with different capitalisation on house 2. Email is
-- case-insensitive in practice and an admin typing "Ada.Landlord@" must not
-- quietly detach a house from its owner.
select pg_temp.check('a differently-capitalised address still matches', (
  select bool_or(house_number = '2') from public.my_landlord_houses()));

select pg_temp.check('another landlord''s house is never listed', (
  select bool_and(house_number <> '4') from public.my_landlord_houses()));

set test.uid = 'c5000000-0000-4000-8000-00000000000b';
select count(*) as n from public.my_landlord_houses() \gset b_
select pg_temp.check('...and Bode sees only his own', :'b_n'::int = 1);

-- ─── A landlord must not read their tenants' debts ───────────────────────────

set test.uid = 'c5000000-0000-4000-8000-00000000000a';
select outstanding_minor as o from public.my_landlord_houses()
 where house_number = '1' \gset h1_
select pg_temp.check('a landlord-billed house shows what the landlord owes',
  :'h1_o'::bigint = 2500000);

select outstanding_minor as o from public.my_landlord_houses()
 where house_number = '2' \gset h2_
-- House 2 bills its resident, who has an open charge. The landlord owes
-- nothing there, and the tenant's debt is not the landlord's to see.
select pg_temp.check('a resident-billed house shows the landlord owing NOTHING',
  :'h2_o'::bigint = 0);

select pg_temp.check('...and the tenant''s charge does exist, so the zero is real', (
  select count(*) = 1 from public.dues_charges
   where membership_id = 'a5000000-0000-4000-8000-000000000001' and status = 'open'));

select pg_temp.check('landlord_dues never returns a resident''s charge', (
  select bool_and(d.house_id is not null) from public.landlord_dues() d));

select count(*) as n from public.landlord_dues() \gset ld_
select pg_temp.check('landlord_dues covers both landlord-billed houses', :'ld_n'::int = 2);

-- ─── Paying ──────────────────────────────────────────────────────────────────

select id as c from public.dues_charges
 where house_id = 'f5000000-0000-4000-8000-000000000001' limit 1 \gset own_
select id as c from public.dues_charges
 where house_id = 'f5000000-0000-4000-8000-000000000004' limit 1 \gset other_
select id as c from public.dues_charges
 where membership_id = 'a5000000-0000-4000-8000-000000000001' limit 1 \gset res_

select ok, subaccount_ref from public.start_landlord_dues_payment(:'own_c') \gset pay_
select pg_temp.check('a landlord can pay their own house''s charge',
  :'pay_ok' = 't' and :'pay_subaccount_ref' = 'RS_ESTATEA00000000000000000001');

select ok, reason from public.start_landlord_dues_payment(:'other_c') \gset oth_
select pg_temp.check('...and cannot pay another landlord''s',
  :'oth_ok' = 'f' and :'oth_reason' = 'not_your_charge');

-- Not merely pointless: paying a tenant's personal dues would disclose what
-- that tenant owed to the person they rent from.
select ok, reason from public.start_landlord_dues_payment(:'res_c') \gset rs_
select pg_temp.check('...and cannot pay a tenant''s personal dues',
  :'rs_ok' = 'f' and :'rs_reason' = 'not_your_charge');

set test.uid = 'c5000000-0000-4000-8000-00000000000c';
select ok, reason from public.start_landlord_dues_payment(:'own_c') \gset unc_
select pg_temp.check('an unconfirmed account cannot start a payment at all',
  :'unc_ok' = 'f' and :'unc_reason' = 'email_not_confirmed');

-- ─── Authority sits with the estate ──────────────────────────────────────────
--
-- The estate says who owns the house. Correcting the address must move access
-- immediately, in both directions, with nothing to reconcile.

update public.houses set landlord_email = 'newowner@example.com'
 where id = 'f5000000-0000-4000-8000-000000000001';

set test.uid = 'c5000000-0000-4000-8000-00000000000a';
select count(*) as n from public.my_landlord_houses() \gset sold_
select pg_temp.check('recording a new owner removes the old one immediately',
  :'sold_n'::int = 2);

select ok, reason from public.start_landlord_dues_payment(:'own_c') \gset sold2_
select pg_temp.check('...including their ability to pay for it',
  :'sold2_ok' = 'f' and :'sold2_reason' = 'not_your_charge');

update public.houses set landlord_email = 'ada.landlord@example.com'
 where id = 'f5000000-0000-4000-8000-000000000001';
select count(*) as n from public.my_landlord_houses() \gset back_
select pg_temp.check('...and restoring it gives access back', :'back_n'::int = 3);

-- A deactivated house leaves the dashboard: it is no longer part of the estate.
update public.houses set is_active = false
 where id = 'f5000000-0000-4000-8000-000000000003';
select count(*) as n from public.my_landlord_houses() \gset deact_
select pg_temp.check('a deactivated house drops off the dashboard', :'deact_n'::int = 2);
update public.houses set is_active = true
 where id = 'f5000000-0000-4000-8000-000000000003';

-- ─── Grants ──────────────────────────────────────────────────────────────────

-- ★ The assertion this file got WRONG first time, which is why it is spelled
-- out. current_verified_email() was revoked from `authenticated` on the
-- instinct that only the server should resolve an identity. But the estates
-- RLS policy CALLS it, and A POLICY RUNS AS THE CALLING ROLE -- so every
-- authenticated read of `estates` started failing 42501, taking the estate
-- dashboard and the guard app's shift lookup down with it.
--
-- The rule, both halves of which this repo has now been bitten by: a definer
-- function used by a POLICY must be executable by the role the policy applies
-- to; one used as an RPC should be revoked from anyone with no business
-- calling it. The same function can need both answers.
--
-- Safe to grant: it takes no argument and returns the caller's own confirmed
-- address, which they signed in with.
select pg_temp.check('the identity helper IS callable by authenticated, because a policy uses it', (
  select has_function_privilege('authenticated', 'public.current_verified_email()', 'execute')
     and not has_function_privilege('anon', 'public.current_verified_email()', 'execute')));

-- The consequence, asserted directly rather than inferred from the grant: an
-- ordinary signed-in user who is NOT a landlord must still be able to read the
-- estates table at all.
set test.uid = 'c5000000-0000-4000-8000-000000000001';
select pg_temp.check('a non-landlord can still read estates (the regression itself)', (
  select count(*) >= 0 from public.estates));

select pg_temp.check('no landlord function is anon-callable', (
  select not has_function_privilege('anon', 'public.is_landlord()', 'execute')
     and not has_function_privilege('anon', 'public.my_landlord_houses()', 'execute')
     and not has_function_privilege('anon', 'public.landlord_dues()', 'execute')
     and not has_function_privilege('anon', 'public.start_landlord_dues_payment(uuid,integer)', 'execute')));

select pg_temp.check('every landlord function pins its search_path', (
  select count(*) = 0 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname in ('current_verified_email','is_landlord','my_landlord_houses',
                       'landlord_dues','start_landlord_dues_payment')
     and not coalesce(array_to_string(p.proconfig,',') like '%search_path=%', false)));

select 'All landlord invariants passed.' as result;
