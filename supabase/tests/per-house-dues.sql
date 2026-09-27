-- Per-house dues terms: invariants.
--
-- An estate manager sets who pays and how much WHEN THEY ADD THE HOUSE, and
-- the same street can mix owner-occupied houses whose owner pays with let
-- houses whose tenants each pay.
--
-- The property that matters most is AGREEMENT. Five things now read a house's
-- terms -- charge generation, the gate, my_dues, my_dues_summary and the
-- reminder fan-out -- and if any two disagree the failure is silent and cruel:
-- a resident refused a visitor code over a debt the app never showed them, or
-- never refused over one it did.

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
-- One estate that bills PER HOUSE by default, containing:
--   H1  no override        -> follows the estate: landlord pays ₦25,000
--   H2  override residents -> each resident pays ₦5,000
--   H3  override amount    -> landlord pays, but ₦40,000
--
-- Mixing them inside ONE estate is the point. An estate-wide setting could
-- never express this, and the old schema could not either.

insert into auth.users (id, email) values
  ('c4000000-0000-4000-8000-00000000000a', 'hadmin@example.com'),
  ('c4000000-0000-4000-8000-000000000001', 'h1res@example.com'),
  ('c4000000-0000-4000-8000-000000000002', 'h2res1@example.com'),
  ('c4000000-0000-4000-8000-000000000003', 'h2res2@example.com'),
  ('c4000000-0000-4000-8000-000000000004', 'h3res@example.com'),
  ('c4000000-0000-4000-8000-000000000005', 'nohouse@example.com');

insert into public.profiles (id, full_name) values
  ('c4000000-0000-4000-8000-00000000000a', 'House Admin'),
  ('c4000000-0000-4000-8000-000000000001', 'H1 Resident'),
  ('c4000000-0000-4000-8000-000000000002', 'H2 Resident One'),
  ('c4000000-0000-4000-8000-000000000003', 'H2 Resident Two'),
  ('c4000000-0000-4000-8000-000000000004', 'H3 Resident'),
  ('c4000000-0000-4000-8000-000000000005', 'No House');

insert into public.estates (id, name, dues_billing_mode, dues_amount_minor, dues_currency,
                            dues_grace_days, settlement_country, settlement_bank_code,
                            settlement_bank_name, settlement_account_number,
                            settlement_account_name, settlement_account_verified,
                            settlement_subaccount_ref, settlement_subaccount_id,
                            settlement_verified_at)
values ('e4000000-0000-4000-8000-000000000001', 'Mixed Estate', 'per_house', 2500000, 'NGN', 7,
        'NG', '044', 'Access Bank', '0690000032', 'Mixed Estate RA', true,
        'RS_MIXEDESTATE00000000000000001', '90010', now());

insert into public.houses (id, estate_id, house_code, house_number, landlord_email,
                           dues_payer, dues_amount_minor) values
  ('f4000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'HH01', '1',
   'owner1@example.com', null, null),
  ('f4000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000001', 'HH02', '2',
   'owner2@example.com', 'residents', 500000),
  ('f4000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000001', 'HH03', '3',
   'owner3@example.com', 'landlord', 4000000);

insert into public.memberships (id, user_id, estate_id, role, house_id) values
  ('a4000000-0000-4000-8000-00000000000a','c4000000-0000-4000-8000-00000000000a','e4000000-0000-4000-8000-000000000001','admin',null),
  ('a4000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','resident','f4000000-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000002','e4000000-0000-4000-8000-000000000001','resident','f4000000-0000-4000-8000-000000000002'),
  ('a4000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000003','e4000000-0000-4000-8000-000000000001','resident','f4000000-0000-4000-8000-000000000002'),
  ('a4000000-0000-4000-8000-000000000004','c4000000-0000-4000-8000-000000000004','e4000000-0000-4000-8000-000000000001','resident','f4000000-0000-4000-8000-000000000003');

-- ─── Terms resolve per house ─────────────────────────────────────────────────

select payer::text as p, amount_minor as a
  from public.house_dues_terms('f4000000-0000-4000-8000-000000000001') \gset h1_
select payer::text as p, amount_minor as a
  from public.house_dues_terms('f4000000-0000-4000-8000-000000000002') \gset h2_
select payer::text as p, amount_minor as a
  from public.house_dues_terms('f4000000-0000-4000-8000-000000000003') \gset h3_

select pg_temp.check('a house with no override follows the estate',
  :'h1_p' = 'landlord' and :'h1_a' = '2500000');
select pg_temp.check('a house can bill its residents inside a landlord-billed estate',
  :'h2_p' = 'residents' and :'h2_a' = '500000');
select pg_temp.check('a house can keep the estate''s payer but set its own figure',
  :'h3_p' = 'landlord' and :'h3_a' = '4000000');

-- ★ Inheritance is a LINK, not a copy. Raising the estate rate must move every
-- house that never set its own, and leave the ones that did alone. Copying at
-- creation would freeze hundreds of houses at last year's figure with nobody
-- the wiser.
update public.estates set dues_amount_minor = 3000000
 where id = 'e4000000-0000-4000-8000-000000000001';

select amount_minor as a from public.house_dues_terms('f4000000-0000-4000-8000-000000000001') \gset r1_
select amount_minor as a from public.house_dues_terms('f4000000-0000-4000-8000-000000000003') \gset r3_
select pg_temp.check('raising the estate rate moves the houses that inherit', :'r1_a' = '3000000');
select pg_temp.check('...and leaves an overridden house alone', :'r3_a' = '4000000');

update public.estates set dues_amount_minor = 2500000
 where id = 'e4000000-0000-4000-8000-000000000001';

-- ─── Generation bills each house on its own terms ────────────────────────────

select public.generate_dues_charges(date_trunc('month', current_date)::date);

select count(*) as n from public.dues_charges
 where house_id = 'f4000000-0000-4000-8000-000000000001' \gset g1_
select pg_temp.check('an inheriting house raises ONE charge against the house', :'g1_n'::int = 1);

select count(*) as n from public.dues_charges
 where house_id = 'f4000000-0000-4000-8000-000000000002' \gset g2h_
select count(*) as n from public.dues_charges c
  join public.memberships m on m.id = c.membership_id
 where m.house_id = 'f4000000-0000-4000-8000-000000000002' \gset g2m_

-- The heart of it: a resident-billed house bills EACH resident, and does not
-- also bill the house. Billing both would charge the same dues twice.
select pg_temp.check('a resident-billed house raises one charge PER RESIDENT',
  :'g2m_n'::int = 2 and :'g2h_n'::int = 0);

select amount_minor as a from public.dues_charges c
  join public.memberships m on m.id = c.membership_id
 where m.house_id = 'f4000000-0000-4000-8000-000000000002' limit 1 \gset g2a_
select pg_temp.check('...each at the HOUSE''s per-resident figure, not the estate''s',
  :'g2a_a' = '500000');

select amount_minor as a from public.dues_charges
 where house_id = 'f4000000-0000-4000-8000-000000000003' \gset g3_
select pg_temp.check('an amount-overriding house is billed at its own figure',
  :'g3_a' = '4000000');

select public.generate_dues_charges(date_trunc('month', current_date)::date) as n \gset rerun_
select pg_temp.check('re-running the month double-bills nobody', :'rerun_n'::int = 0);

-- ─── The gate reads the same terms ───────────────────────────────────────────
--
-- Made overdue by hand rather than by waiting a month.
update public.dues_charges set due_on = current_date - 1
 where estate_id = 'e4000000-0000-4000-8000-000000000001';

set test.uid = 'c4000000-0000-4000-8000-00000000000a';
select public.set_dues_enforcement('e4000000-0000-4000-8000-000000000001', true, 'AGM 2026');

select pg_temp.check('a resident of a landlord-billed house is blocked by the HOUSE''s debt',
  public.dues_in_arrears('a4000000-0000-4000-8000-000000000001'));
select pg_temp.check('a resident of a resident-billed house is blocked by their OWN debt',
  public.dues_in_arrears('a4000000-0000-4000-8000-000000000002'));

-- One housemate paying must free only themselves: their debt is theirs.
update public.dues_charges set status = 'paid', paid_at = now()
 where membership_id = 'a4000000-0000-4000-8000-000000000002';

select pg_temp.check('paying frees the resident who paid',
  not public.dues_in_arrears('a4000000-0000-4000-8000-000000000002'));
select pg_temp.check('...and leaves their housemate still owing',
  public.dues_in_arrears('a4000000-0000-4000-8000-000000000003'));

-- Whereas in a landlord-billed house the debt is the house's, so settling it
-- frees everyone living there at once.
update public.dues_charges set status = 'paid', paid_at = now()
 where house_id = 'f4000000-0000-4000-8000-000000000003';
select pg_temp.check('settling a landlord-billed house frees its residents',
  not public.dues_in_arrears('a4000000-0000-4000-8000-000000000004'));

-- ─── What each resident is shown ─────────────────────────────────────────────

set test.uid = 'c4000000-0000-4000-8000-000000000001';
select billing_mode::text as bm, amount_minor as a, subject as s
  from public.my_dues('e4000000-0000-4000-8000-000000000001') limit 1 \gset m1_
select pg_temp.check('a landlord-billed resident sees a HOUSE charge, so the app offers the landlord',
  :'m1_bm' = 'per_house' and :'m1_s' = 'house' and :'m1_a' = '2500000');

set test.uid = 'c4000000-0000-4000-8000-000000000003';
select billing_mode::text as bm, amount_minor as a, subject as s
  from public.my_dues('e4000000-0000-4000-8000-000000000001') limit 1 \gset m2_
select pg_temp.check('a resident-billed resident sees their OWN charge, so the app offers Pay',
  :'m2_bm' = 'per_resident' and :'m2_s' = 'resident' and :'m2_a' = '500000');

select count(*) as n from public.my_dues('e4000000-0000-4000-8000-000000000001') \gset m2n_
select pg_temp.check('...and sees only their own, never a housemate''s', :'m2n_n'::int = 1);

select monthly_minor as mm, billing_mode::text as bm
  from public.my_dues_summary('e4000000-0000-4000-8000-000000000001') \gset s2_
select pg_temp.check('the summary quotes the HOUSE''s figure, not the estate''s',
  :'s2_mm' = '500000' and :'s2_bm' = 'per_resident');

-- ─── Chasing a whole house ───────────────────────────────────────────────────

set test.uid = 'c4000000-0000-4000-8000-00000000000a';
-- Reopen the housemate who paid, so the house has two people to chase.
update public.dues_charges set status = 'open', paid_at = null
 where membership_id = 'a4000000-0000-4000-8000-000000000002';

select public.remind_house_dues('f4000000-0000-4000-8000-000000000002') as n \gset rh_
select pg_temp.check('reminding a resident-billed house reaches every resident in it',
  :'rh_n'::int >= 2);

select count(distinct sent_to) as n from public.dues_reminders r
  join public.dues_charges c on c.id = r.charge_id
  join public.memberships m on m.id = c.membership_id
 where m.house_id = 'f4000000-0000-4000-8000-000000000002' \gset rt_
select pg_temp.check('...at two different addresses, one each', :'rt_n'::int = 2);

-- Each about THEIR OWN charge. A reminder naming a housemate's debt would tell
-- two people about a third person's money.
select pg_temp.check('nobody is told what their housemate owes', (
  select bool_and(u.email = r.sent_to)
    from public.dues_reminders r
    join public.dues_charges c on c.id = r.charge_id
    join public.memberships m on m.id = c.membership_id
    join auth.users u on u.id = m.user_id
   where m.house_id = 'f4000000-0000-4000-8000-000000000002'));

select pg_temp.check('only an admin may chase a house', (
  select not has_function_privilege('anon', 'public.remind_house_dues(uuid)', 'execute')));

-- ─── An estate that does not bill overrides every house ──────────────────────
--
-- A house override says HOW this house is billed, never that it is billed at
-- all. Otherwise switching dues off at the estate would leave overridden
-- houses quietly still charging.

update public.estates set dues_billing_mode = 'none', dues_amount_minor = null,
       dues_currency = null
 where id = 'e4000000-0000-4000-8000-000000000001';

select count(*) as n from public.house_dues_terms('f4000000-0000-4000-8000-000000000002') \gset off_
select pg_temp.check('a house override cannot bill inside a switched-off estate',
  :'off_n'::int = 0);

select pg_temp.check('...and nobody is blocked once dues are off',
  not public.dues_in_arrears('a4000000-0000-4000-8000-000000000003'));

select 'All per-house dues invariants passed.' as result;
