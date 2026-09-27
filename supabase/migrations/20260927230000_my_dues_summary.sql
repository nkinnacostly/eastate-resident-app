-- Estate Access Platform — the numbers a resident's Dues tab opens with
--
-- `my_dues` lists charges, which is the wrong shape for the top of a screen in
-- one specific and important case: AN ESTATE WITH DUES CONFIGURED BUT NO
-- CHARGES RAISED YET RETURNS ZERO ROWS. A list-only screen would then render
-- "nothing here" to a resident who owes ₦2,500 from the 1st — the most
-- misleading thing it could possibly say, and the exact class of silence that
-- produced the "could not generate a code" dead end.
--
-- So the summary is computed server-side and always returns exactly one row,
-- including for an estate that does not bill at all. What is owed and what
-- falls due next are facts about the ESTATE'S CONFIGURATION, not about the
-- rows that happen to exist.
--
-- Deliberately not derived in the app. The next due date depends on the
-- estate's grace period and on when charges are actually raised, and a client
-- reimplementing that arithmetic is a client that will disagree with the gate
-- the first time either changes.

create function public.my_dues_summary(p_estate_id uuid)
returns table (
  billing_mode      public.dues_billing_mode,
  monthly_minor     bigint,
  currency          text,
  grace_days        integer,
  enforcement_on    boolean,

  -- Everything still open, whether or not it is late.
  outstanding_minor bigint,
  outstanding_count integer,
  -- The subset that is past its due date. This is what the gate acts on.
  overdue_minor     bigint,
  overdue_count     integer,
  paid_count        integer,

  -- True only when arrears ACTUALLY stop this resident minting: something is
  -- overdue AND the estate authorised enforcement. Computed here rather than
  -- composed in the app so one definition drives the banner, the tab and the
  -- gate.
  blocked           boolean,

  -- The next month that has not been billed yet, and when it will fall due.
  -- Null when the estate does not bill through the app.
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
  v_last       date;
begin
  if v_membership is null then
    raise exception 'not_a_resident' using errcode = '42501';
  end if;

  select m.house_id into v_house from public.memberships m where m.id = v_membership;
  select * into e from public.estates where id = p_estate_id;

  -- One row, always. A screen that has to branch on "did I get a row" before
  -- it can say anything is a screen that will one day say nothing.
  return query
  with mine as (
    select c.*
      from public.dues_charges c
     where c.estate_id = p_estate_id
       and ((e.dues_billing_mode = 'per_house'    and c.house_id = v_house)
         or (e.dues_billing_mode = 'per_resident' and c.membership_id = v_membership))
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
    e.dues_billing_mode,
    e.dues_amount_minor,
    e.dues_currency,
    e.dues_grace_days,
    (e.dues_enforcement_authorised_at is not null),
    a.outstanding_minor, a.outstanding_count,
    a.overdue_minor, a.overdue_count, a.paid_count,
    (a.overdue_count > 0 and e.dues_enforcement_authorised_at is not null),
    case when e.dues_billing_mode = 'none' then null else np.p end,
    case when e.dues_billing_mode = 'none' then null
         else np.p + e.dues_grace_days end
  from agg a
  -- The first month not yet billed: the month after the latest charge, but
  -- never earlier than the current one. An estate configured mid-month has no
  -- charge for this month until the admin raises it, and "next" should then be
  -- this month rather than a date already past.
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

comment on function public.my_dues_summary is
  'One row, always, for the top of the resident Dues tab -- including for an '
  'estate whose charges have not been raised yet, where my_dues returns '
  'nothing and a list-only screen would wrongly read as "you owe nothing".';
