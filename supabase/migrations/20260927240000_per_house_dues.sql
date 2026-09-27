-- Estate Access Platform — dues terms belong to the HOUSE, not only the estate
--
-- Until now an estate chose one billing model for every house it contains:
-- either the landlord pays for all of them, or each resident pays for all of
-- them. Real estates are not uniform. The same street has owner-occupied
-- houses whose owner pays, and let houses whose tenants each pay a service
-- charge, and an estate manager knows which is which AT THE MOMENT THEY ADD
-- THE HOUSE -- not later, from a separate settings page.
--
-- So a house now carries its own terms:
--
--   dues_payer         'landlord' | 'residents' | null  (null = follow the estate)
--   dues_amount_minor  a figure                | null  (null = follow the estate)
--
-- ─── Null means inherit, and that is the important part ─────────────────────
--
-- Not a copy of the estate's value taken at creation time. If an estate raises
-- its monthly rate, every house that never set its own must move with it --
-- copying would silently freeze hundreds of houses at last year's figure, and
-- nobody would notice until an audit. An override is a deliberate act and
-- looks like one; the absence of an override is not a decision at all.
--
-- ─── What 'residents' means for money ───────────────────────────────────────
--
-- The amount is PER RESIDENT, not a total split between them. A house with
-- three residents at ₦5,000 raises three charges of ₦5,000, because that is
-- what "each resident is expected to pay" means and because splitting a total
-- would change every resident's bill whenever somebody moved in or out.

create type public.house_dues_payer as enum ('landlord', 'residents');

alter table public.houses add column dues_payer public.house_dues_payer;
alter table public.houses add column dues_amount_minor bigint;

alter table public.houses
  add constraint houses_dues_amount_ck
  check (dues_amount_minor is null or dues_amount_minor > 0);

comment on column public.houses.dues_payer is
  'Who pays this house''s dues. NULL follows the estate''s billing mode -- not '
  'a copy of it, so a change to the estate rate reaches every house that never '
  'set its own.';
comment on column public.houses.dues_amount_minor is
  'Per RESIDENT when dues_payer = residents, not a total to be split: a split '
  'would rewrite everyone''s bill whenever a housemate moved in or out.';

-- ─── One definition of a house's terms ───────────────────────────────────────
--
-- Charge generation, the gate, both resident read paths and the reminder
-- recipients all need to answer "who pays for this house, and how much". Four
-- copies of that logic is four chances to disagree, and the one that disagrees
-- silently is the gate -- a resident refused a code for a charge the app never
-- showed them.

create function public.house_dues_terms(p_house_id uuid)
returns table (payer public.house_dues_payer, amount_minor bigint, currency text, grace_days integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      h.dues_payer,
      case e.dues_billing_mode
        when 'per_house'    then 'landlord'::public.house_dues_payer
        when 'per_resident' then 'residents'::public.house_dues_payer
      end
    ),
    coalesce(h.dues_amount_minor, e.dues_amount_minor),
    e.dues_currency,
    e.dues_grace_days
  from public.houses h
  join public.estates e on e.id = h.estate_id
 where h.id = p_house_id
   -- An estate that does not bill at all overrides everything below it. A
   -- house override is a choice about HOW this house is billed, never a way
   -- to bill inside an estate that has switched dues off.
   and e.dues_billing_mode <> 'none';
$$;

revoke execute on function public.house_dues_terms(uuid) from public, anon, authenticated;

-- ─── Setting the terms ───────────────────────────────────────────────────────
--
-- Separate from create_house so they can also be changed afterwards, and so
-- the bulk importer can reach them. Passing nulls clears the override and the
-- house follows the estate again.

create function public.set_house_dues(
  p_house_id     uuid,
  p_payer        public.house_dues_payer default null,
  p_amount_minor bigint default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_estate uuid;
begin
  select estate_id into v_estate from public.houses where id = p_house_id;
  if v_estate is null then
    raise exception 'no_such_house' using errcode = '42704';
  end if;

  if public.current_membership(v_estate, 'admin') is null
     and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if p_amount_minor is not null and p_amount_minor <= 0 then
    raise exception 'dues_amount_must_be_positive' using errcode = '22023';
  end if;

  update public.houses
     set dues_payer = p_payer,
         dues_amount_minor = p_amount_minor
   where id = p_house_id;
end;
$$;

revoke execute on function public.set_house_dues(uuid, public.house_dues_payer, bigint) from public, anon;
grant  execute on function public.set_house_dues(uuid, public.house_dues_payer, bigint) to authenticated;

-- ─── Picking the terms while adding the house ────────────────────────────────
--
-- The estate manager knows who pays at the moment they type the address. Making
-- them add the house, find it in a list and open a second screen to say so is
-- how houses end up on the wrong terms for a month.

drop function if exists public.create_house(uuid, text, text, text, text);

create function public.create_house(
  p_estate_id      uuid,
  p_house_number   text,
  p_landlord_name  text default null,
  p_landlord_phone text default null,
  p_landlord_email text default null,
  p_dues_payer     public.house_dues_payer default null,
  p_dues_amount_minor bigint default null
)
returns table (id uuid, house_code text, house_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house  public.houses;
  v_number text := nullif(btrim(p_house_number), '');
  v_try    text;
begin
  if public.current_membership(p_estate_id, 'admin') is null
     and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if v_number is null then
    raise exception 'house_number_required' using errcode = '22023';
  end if;

  if p_dues_amount_minor is not null and p_dues_amount_minor <= 0 then
    raise exception 'dues_amount_must_be_positive' using errcode = '22023';
  end if;

  -- Retry until the code is free WITHIN this estate. 4 glyphs is a small space
  -- by design, so a collision is ordinary rather than exceptional.
  loop
    v_try := public.generate_code(4);
    exit when not exists (
      select 1 from public.houses h
       where h.estate_id = p_estate_id and h.house_code = v_try
    );
  end loop;

  insert into public.houses (
    estate_id, house_code, house_number, landlord_name, landlord_phone, landlord_email,
    dues_payer, dues_amount_minor)
  values (
    p_estate_id, v_try, v_number,
    nullif(btrim(p_landlord_name), ''),
    nullif(btrim(p_landlord_phone), ''),
    nullif(btrim(p_landlord_email), ''),
    p_dues_payer, p_dues_amount_minor)
  returning * into v_house;

  return query select v_house.id, v_house.house_code, v_house.house_number;
end;
$$;

revoke execute on function public.create_house(uuid, text, text, text, text,
  public.house_dues_payer, bigint) from public, anon;
grant  execute on function public.create_house(uuid, text, text, text, text,
  public.house_dues_payer, bigint) to authenticated;

-- ─── Raising the month ───────────────────────────────────────────────────────
--
-- Three populations, and the third is the one that is easy to drop: a resident
-- with no house recorded. They exist in every estate that has ever onboarded
-- somebody before their address was known, and a rewrite that only walks
-- houses stops billing them silently.

create or replace function public.generate_dues_charges(
  p_period date default date_trunc('month', current_date)::date
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', p_period::timestamptz)::date;
  v_count  integer := 0;
  v_added  integer;
begin
  -- 1. Houses the landlord pays for: one charge against the house.
  insert into public.dues_charges
    (estate_id, period, house_id, amount_minor, currency, due_on)
  select h.estate_id, v_period, h.id, t.amount_minor, t.currency,
         v_period + t.grace_days
    from public.houses h
    join public.estates e on e.id = h.estate_id and e.is_active
    -- house_dues_terms returns NO ROW for an estate that does not bill, so a
    -- lateral join is also the filter: a house in a switched-off estate simply
    -- disappears from this query rather than needing a separate guard.
    cross join lateral public.house_dues_terms(h.id) t
   where h.is_active
     and t.payer = 'landlord'
     and t.amount_minor is not null
  -- Re-running the month is a no-op rather than a double-bill. That property
  -- is what makes this safe to invoke by hand after a failed cron.
  on conflict do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  -- 2. Houses the residents pay for: one charge EACH, at the house's rate.
  --    Per resident, not a total split between them -- see the note at the top
  --    of this file on why splitting would rewrite everyone's bill whenever a
  --    housemate moved in or out.
  insert into public.dues_charges
    (estate_id, period, membership_id, amount_minor, currency, due_on)
  select h.estate_id, v_period, m.id, t.amount_minor, t.currency,
         v_period + t.grace_days
    from public.houses h
    join public.estates e on e.id = h.estate_id and e.is_active
    cross join lateral public.house_dues_terms(h.id) t
    join public.memberships m
      on m.house_id = h.id and m.role = 'resident' and m.is_active
   where h.is_active
     and t.payer = 'residents'
     and t.amount_minor is not null
  on conflict do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  -- 3. Residents with no house on record, in an estate that bills residents.
  --    They have no house whose terms could apply, so the estate's own figure
  --    is the only one there is.
  insert into public.dues_charges
    (estate_id, period, membership_id, amount_minor, currency, due_on)
  select e.id, v_period, m.id, e.dues_amount_minor, e.dues_currency,
         v_period + e.dues_grace_days
    from public.estates e
    join public.memberships m
      on m.estate_id = e.id and m.role = 'resident' and m.is_active
     and m.house_id is null
   where e.dues_billing_mode = 'per_resident'
     and e.is_active
  on conflict do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  return v_count;
end;
$$;

revoke execute on function public.generate_dues_charges(date) from public, anon, authenticated;

-- ─── The gate follows the house ──────────────────────────────────────────────
--
-- This MUST agree with generation. If generation bills a resident directly and
-- the gate looks at the house's charges, a resident is refused a code over a
-- debt that is not theirs -- or worse, never refused over one that is.

create or replace function public.dues_in_arrears(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Unauthorised enforcement is not enforcement. An estate that has not
    -- recorded a basis bills normally and restricts nobody.
    when e.dues_enforcement_authorised_at is null then false
    when e.dues_billing_mode = 'none' then false

    -- No house on record: billed directly, whatever any house does.
    when m.house_id is null then exists (
      select 1 from public.dues_charges c
       where c.membership_id = m.id
         and c.status = 'open'
         and c.due_on < current_date)

    when (select t.payer from public.house_dues_terms(m.house_id) t) = 'landlord' then exists (
      select 1 from public.dues_charges c
       where c.house_id = m.house_id
         and c.status = 'open'
         and c.due_on < current_date)

    else exists (
      select 1 from public.dues_charges c
       where c.membership_id = m.id
         and c.status = 'open'
         and c.due_on < current_date)
  end
  from public.memberships m
  join public.estates e on e.id = m.estate_id
  where m.id = p_membership_id;
$$;

revoke execute on function public.dues_in_arrears(uuid) from public, anon, authenticated;

-- ─── What the resident sees ──────────────────────────────────────────────────
--
-- `billing_mode` keeps its name and its enum, but now reports the EFFECTIVE
-- terms for this resident's house rather than the estate's blanket setting.
-- From a resident's point of view the question was never "what does this
-- estate do" -- it is "is this billed to my house or to me", and that is what
-- the app branches on to decide whether to show a Pay button or the landlord's
-- phone number.

drop function if exists public.my_dues(uuid);

create function public.my_dues(p_estate_id uuid)
returns table (
  charge_id     uuid,
  period        date,
  amount_minor  bigint,
  currency      text,
  due_on        date,
  status        public.dues_charge_status,
  is_overdue    boolean,
  billing_mode  public.dues_billing_mode,
  subject       text,
  pay_token     text,
  landlord_name  text,
  landlord_phone text,
  landlord_email text,
  enforcement_on boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership uuid := public.current_membership(p_estate_id, 'resident');
  v_house      uuid;
  v_enforce    boolean;
  v_payer      public.house_dues_payer;
  v_mode       public.dues_billing_mode;
begin
  if v_membership is null then
    raise exception 'not_a_resident' using errcode = '42501';
  end if;

  select m.house_id, e.dues_enforcement_authorised_at is not null
    into v_house, v_enforce
    from public.memberships m join public.estates e on e.id = m.estate_id
   where m.id = v_membership;

  if v_house is not null then
    select t.payer into v_payer from public.house_dues_terms(v_house) t;
  end if;

  -- Mapped back onto the estate-level enum the app already understands, so a
  -- landlord-billed house reads as 'per_house' whether that came from the
  -- estate default or from this house's own override.
  v_mode := case
    when v_house is null then 'per_resident'::public.dues_billing_mode
    when v_payer = 'landlord' then 'per_house'::public.dues_billing_mode
    when v_payer = 'residents' then 'per_resident'::public.dues_billing_mode
    else 'none'::public.dues_billing_mode
  end;

  return query
  select c.id, c.period, c.amount_minor, c.currency, c.due_on, c.status,
         (c.status = 'open' and c.due_on < current_date),
         v_mode,
         case when c.house_id is not null then 'house' else 'resident' end,
         c.pay_token,
         h.landlord_name, h.landlord_phone, h.landlord_email,
         coalesce(v_enforce, false)
    from public.dues_charges c
    left join public.houses h on h.id = c.house_id
   where c.estate_id = p_estate_id
     -- Both shapes, selected by what actually bills THIS resident rather than
     -- by an estate-wide mode: a house charge for their house when the
     -- landlord pays, their own charge when they do.
     and ((v_payer = 'landlord' and c.house_id = v_house)
       or (v_payer is distinct from 'landlord' and c.membership_id = v_membership))
   order by c.period desc
   limit 24;
end;
$$;

revoke execute on function public.my_dues(uuid) from public, anon;
grant  execute on function public.my_dues(uuid) to authenticated;

-- ─── ...and the numbers the Dues tab opens with ──────────────────────────────

drop function if exists public.my_dues_summary(uuid);

create function public.my_dues_summary(p_estate_id uuid)
returns table (
  billing_mode      public.dues_billing_mode,
  monthly_minor     bigint,
  currency          text,
  grace_days        integer,
  enforcement_on    boolean,
  outstanding_minor bigint,
  outstanding_count integer,
  overdue_minor     bigint,
  overdue_count     integer,
  paid_count        integer,
  blocked           boolean,
  next_period       date,
  next_due_on       date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership uuid := public.current_membership(p_estate_id, 'resident');
  v_house      uuid;
  e            public.estates%rowtype;
  v_payer      public.house_dues_payer;
  v_amount     bigint;
  v_grace      integer;
  v_mode       public.dues_billing_mode;
begin
  if v_membership is null then
    raise exception 'not_a_resident' using errcode = '42501';
  end if;

  select m.house_id into v_house from public.memberships m where m.id = v_membership;
  select * into e from public.estates where id = p_estate_id;

  if v_house is not null then
    select t.payer, t.amount_minor, t.grace_days
      into v_payer, v_amount, v_grace
      from public.house_dues_terms(v_house) t;
  end if;

  -- The HOUSE's figure, not the estate's. Showing an estate default to a
  -- resident whose house is billed at a different rate is worse than showing
  -- nothing: they would budget for the wrong number.
  v_amount := coalesce(v_amount, e.dues_amount_minor);
  v_grace  := coalesce(v_grace, e.dues_grace_days);

  v_mode := case
    when e.dues_billing_mode = 'none' then 'none'::public.dues_billing_mode
    when v_house is null then 'per_resident'::public.dues_billing_mode
    when v_payer = 'landlord' then 'per_house'::public.dues_billing_mode
    when v_payer = 'residents' then 'per_resident'::public.dues_billing_mode
    else 'none'::public.dues_billing_mode
  end;

  return query
  with mine as (
    select c.*
      from public.dues_charges c
     where c.estate_id = p_estate_id
       and ((v_payer = 'landlord' and c.house_id = v_house)
         or (v_payer is distinct from 'landlord' and c.membership_id = v_membership))
  ),
  agg as (
    select
      coalesce(sum(amount_minor) filter (where status = 'open'), 0)::bigint as outstanding_minor,
      count(*) filter (where status = 'open')::integer                      as outstanding_count,
      coalesce(sum(amount_minor) filter (
        where status = 'open' and due_on < current_date), 0)::bigint        as overdue_minor,
      count(*) filter (where status = 'open' and due_on < current_date)::integer as overdue_count,
      count(*) filter (where status = 'paid')::integer                      as paid_count,
      max(period)                                                           as last_period
      from mine
  )
  select
    v_mode,
    case when v_mode = 'none' then null else v_amount end,
    e.dues_currency,
    v_grace,
    (e.dues_enforcement_authorised_at is not null),
    a.outstanding_minor, a.outstanding_count,
    a.overdue_minor, a.overdue_count, a.paid_count,
    (a.overdue_count > 0 and e.dues_enforcement_authorised_at is not null),
    case when v_mode = 'none' then null else np.p end,
    case when v_mode = 'none' then null else np.p + v_grace end
  from agg a
  cross join lateral (
    select greatest(
             date_trunc('month', current_date)::date,
             coalesce((a.last_period + interval '1 month')::date,
                      date_trunc('month', current_date)::date)
           ) as p
  ) np;
end;
$$;

revoke execute on function public.my_dues_summary(uuid) from public, anon;
grant  execute on function public.my_dues_summary(uuid) to authenticated;

-- ─── Reminding a whole house at once ─────────────────────────────────────────
--
-- Where the landlord pays there is one charge and one press. Where the
-- RESIDENTS pay there is a charge each, and an admin chasing a house would
-- otherwise have to find and press every resident's row individually --
-- tedious for three, and the kind of thing that gets half-done for six.
--
-- Each person is still reminded about THEIR OWN charge. That matters: a
-- reminder naming what a housemate owes would tell two people about a third
-- person's debt, which is not the estate's to share.

create function public.remind_house_dues(p_house_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_estate uuid;
  v_admin  uuid;
  r        record;
  v_sent   integer := 0;
begin
  select estate_id into v_estate from public.houses where id = p_house_id;
  if v_estate is null then
    raise exception 'no_such_house' using errcode = '42704';
  end if;

  v_admin := public.current_membership(v_estate, 'admin');
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  -- Every open charge attached to this house, by either shape: the house's own
  -- when the landlord pays, and each resident's when they do.
  for r in
    select c.id
      from public.dues_charges c
     where c.status = 'open'
       and (c.house_id = p_house_id
         or c.membership_id in (
              select m.id from public.memberships m
               where m.house_id = p_house_id and m.role = 'resident' and m.is_active))
     order by c.period desc
  loop
    v_sent := v_sent + public.send_dues_reminder(r.id, 'manual', v_admin);
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.remind_house_dues(uuid) from public, anon;
grant  execute on function public.remind_house_dues(uuid) to authenticated;

comment on function public.remind_house_dues is
  'Chase a whole house in one press. Each person is reminded about their OWN '
  'charge -- naming a housemate''s debt would share it with people it does not '
  'belong to.';
