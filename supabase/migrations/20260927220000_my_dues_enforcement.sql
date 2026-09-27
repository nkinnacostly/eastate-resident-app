-- Estate Access Platform — tell the resident whether dues actually BLOCK them
--
-- Reported after the first real use: a resident with overdue dues pressed
-- Generate, was refused, and the app said "Could not generate a code. Please
-- try again." Trying again was never going to work. Nothing on the screen
-- before that moment said anything was owed.
--
-- The app could not have done better with what it had. `my_dues` returned what
-- is owed and when, but NOT whether this estate has switched enforcement on --
-- and without that the app cannot tell the difference between:
--
--   overdue, enforcement OFF -> you owe money; codes still work
--   overdue, enforcement ON  -> you owe money; codes are paused until you pay
--
-- Those need different words. Saying "you cannot generate codes" to someone who
-- can is a lie the first tap disproves; saying nothing to someone who cannot is
-- the dead end that was reported. So the flag comes back with the charges, from
-- the same call, and the app stops guessing.

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
  -- Whether THIS ESTATE has recorded authority to withhold code generation.
  -- Not whether this resident is currently blocked -- that is is_overdue AND
  -- this, and the app composes them.
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
  v_mode       public.dues_billing_mode;
  v_enforce    boolean;
begin
  if v_membership is null then
    raise exception 'not_a_resident' using errcode = '42501';
  end if;

  select m.house_id, e.dues_billing_mode, e.dues_enforcement_authorised_at is not null
    into v_house, v_mode, v_enforce
    from public.memberships m join public.estates e on e.id = m.estate_id
   where m.id = v_membership;

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
     and ((v_mode = 'per_house'    and c.house_id = v_house)
       or (v_mode = 'per_resident' and c.membership_id = v_membership))
   order by c.period desc
   limit 24;
end;
$$;

revoke execute on function public.my_dues(uuid) from public, anon;
grant  execute on function public.my_dues(uuid) to authenticated;

comment on function public.my_dues is
  'A resident''s own charges, plus whether the estate enforces arrears. The '
  'flag exists so the app can say "codes are paused until you pay" only when '
  'that is true, and "you owe this" when it is not.';
