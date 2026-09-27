-- Estate Access Platform — tell a resident WHO to chase
--
-- When the landlord pays, "your dues are unpaid" is useless on its own. The
-- resident cannot settle a bill they were never given and, in most cases, does
-- not hold the landlord's number in a form they can act on at a gate. So
-- my_dues now returns the landlord's details for a house-billed charge, and the
-- app leads with them instead of a Pay button the resident cannot honour.
--
-- ─── Why this is not a privacy problem ───────────────────────────────────────
--
-- These are the contact details of the person responsible for the dwelling the
-- resident lives in, released only to an active resident OF THAT HOUSE, and
-- only for a charge that house actually owes. A tenant already has their
-- landlord's number; what they usually do not have is it to hand, attached to
-- the bill, at the moment it matters.
--
-- It is still scoped tightly: per_resident estates get nothing back here
-- (there is no landlord in that arrangement), and nothing exposes a landlord
-- to anyone outside their own house.

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
  -- Null unless this is a house charge. The app branches on billing_mode
  -- rather than on these being present, so a house with no landlord on record
  -- still gets the right screen -- just with a fallback to the estate office.
  landlord_name  text,
  landlord_phone text,
  landlord_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership uuid := public.current_membership(p_estate_id, 'resident');
  v_house      uuid;
  v_mode       public.dues_billing_mode;
begin
  if v_membership is null then
    raise exception 'not_a_resident' using errcode = '42501';
  end if;

  select m.house_id, e.dues_billing_mode into v_house, v_mode
    from public.memberships m join public.estates e on e.id = m.estate_id
   where m.id = v_membership;

  return query
  select c.id, c.period, c.amount_minor, c.currency, c.due_on, c.status,
         (c.status = 'open' and c.due_on < current_date),
         v_mode,
         case when c.house_id is not null then 'house' else 'resident' end,
         c.pay_token,
         h.landlord_name, h.landlord_phone, h.landlord_email
    from public.dues_charges c
    -- Left join: a charge against this resident directly has no house, and a
    -- backfilled house may have no landlord recorded. Neither is an error.
    left join public.houses h on h.id = c.house_id
   where c.estate_id = p_estate_id
     and ((v_mode = 'per_house'    and c.house_id = v_house)
       or (v_mode = 'per_resident' and c.membership_id = v_membership))
   order by c.period desc
   limit 24;
end;
$$;

revoke execute on function public.my_dues(uuid) from public, anon;
grant  execute on function public.my_dues(uuid) to authenticated;
