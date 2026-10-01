-- Estate Access Platform — the payment ledgers show the months a payment covered
--
-- With pay-ahead (20261001130000) one payment can cover a year. Both ledgers,
-- the operator's and the estate admin's, now say how many months and which.
-- A RETURNS TABLE shape cannot be altered in place, so the helper and both
-- RPCs are dropped and recreated with the same bodies plus three columns.

drop function public.estate_dues_payments(uuid, timestamptz, timestamptz, integer);
drop function public.operator_dues_payments(uuid, timestamptz, timestamptz, integer);
drop function private.dues_payment_rows(uuid, timestamptz, timestamptz, integer);

create function private.dues_payment_rows(
  p_estate_id uuid        default null,
  p_since     timestamptz default null,
  p_until     timestamptz default null,
  p_limit     integer     default 2000
)
returns table (
  payment_id          uuid,
  created_at          timestamptz,
  settled_at          timestamptz,
  status              text,
  estate_id           uuid,
  estate_name         text,
  house_number        text,
  charge_id           uuid,
  charge_period       date,
  charge_due_on       date,
  charge_status       text,
  billed_to           text,
  billed_name         text,
  payer_name          text,
  payer_email         text,
  payer_phone         text,
  paid_via            text,
  amount_minor        bigint,
  currency            text,
  charged_minor       bigint,
  provider_fee_minor  bigint,
  settled_minor       bigint,
  platform_fee_percent numeric,
  platform_fee_minor  bigint,
  tx_ref              text,
  provider            text,
  provider_tx_id      text,
  provider_ref        text,
  payment_type        text,
  card_brand          text,
  card_last4          text,
  card_issuer         text,
  processor_response  text,
  months              integer,
  covers_from         date,
  covers_until        date
)
language plpgsql
stable
set search_path = ''
as $$
begin
  return query
  select
    p.id,
    p.created_at,
    p.settled_at,
    p.status::text,
    c.estate_id,
    e.name,
    coalesce(h.house_number, rh.house_number),
    c.id,
    c.period,
    c.due_on,
    c.status::text,
    case when c.house_id is not null then 'house' else 'resident' end,
    -- Who the charge is FOR, which is not always who paid it: a per-house bill
    -- is the landlord's, and a tenant may have settled it for them.
    case when c.house_id is not null then h.landlord_name else bp.full_name end,
    coalesce(ip.full_name, nullif(p.raw_payload -> 'customer' ->> 'name', '')),
    coalesce(p.payer_email, nullif(p.raw_payload -> 'customer' ->> 'email', '')),
    coalesce(nullif(ip.phone, ''), nullif(p.raw_payload -> 'customer' ->> 'phone_number', '')),
    -- How the payment was started. A link payment has no membership behind it
    -- by design: the landlord paying from an emailed link has no account here.
    case
      when im.role is not null then im.role::text
      else 'pay_link'
    end,
    p.amount_minor,
    p.currency,
    private.payload_minor(p.raw_payload, 'charged_amount'),
    private.payload_minor(p.raw_payload, 'app_fee'),
    private.payload_minor(p.raw_payload, 'amount_settled'),
    p.platform_fee_percent,
    -- Only money that actually moved earns commission.
    case when p.status = 'successful' and p.platform_fee_percent is not null
         then round(p.amount_minor * p.platform_fee_percent)::bigint end,
    p.tx_ref,
    p.provider,
    p.provider_tx_id,
    nullif(p.raw_payload ->> 'flw_ref', ''),
    nullif(p.raw_payload ->> 'payment_type', ''),
    nullif(p.raw_payload -> 'card' ->> 'type', ''),
    nullif(p.raw_payload -> 'card' ->> 'last_4digits', ''),
    nullif(p.raw_payload -> 'card' ->> 'issuer', ''),
    nullif(p.raw_payload ->> 'processor_response', ''),
    p.months,
    -- A payment from before pay-ahead has no plan rows; it covered its own
    -- charge's month and nothing else.
    coalesce((select min(pp.period) from public.dues_payment_periods pp where pp.payment_id = p.id), c.period),
    coalesce((select max(pp.period) from public.dues_payment_periods pp where pp.payment_id = p.id), c.period)
  from public.dues_payments p
  join public.dues_charges c on c.id = p.charge_id
  join public.estates e      on e.id = c.estate_id
  left join public.houses h       on h.id = c.house_id
  left join public.memberships bm on bm.id = c.membership_id
  left join public.profiles bp    on bp.id = bm.user_id
  left join public.houses rh      on rh.id = bm.house_id
  left join public.memberships im on im.id = p.initiated_by_membership_id
  left join public.profiles ip    on ip.id = im.user_id
  where (p_estate_id is null or c.estate_id = p_estate_id)
    and (p_since is null or p.created_at >= p_since)
    and (p_until is null or p.created_at <  p_until)
  order by p.created_at desc, p.id
  limit least(greatest(coalesce(p_limit, 2000), 1), 10000);
end;
$$;

revoke execute on function private.dues_payment_rows(uuid, timestamptz, timestamptz, integer)
  from public, anon, authenticated;

create function public.operator_dues_payments(
  p_estate_id uuid        default null,
  p_since     timestamptz default null,
  p_until     timestamptz default null,
  p_limit     integer     default 2000
)
returns table (
  payment_id          uuid,
  created_at          timestamptz,
  settled_at          timestamptz,
  status              text,
  estate_id           uuid,
  estate_name         text,
  house_number        text,
  charge_id           uuid,
  charge_period       date,
  charge_due_on       date,
  charge_status       text,
  billed_to           text,
  billed_name         text,
  payer_name          text,
  payer_email         text,
  payer_phone         text,
  paid_via            text,
  amount_minor        bigint,
  currency            text,
  charged_minor       bigint,
  provider_fee_minor  bigint,
  settled_minor       bigint,
  platform_fee_percent numeric,
  platform_fee_minor  bigint,
  tx_ref              text,
  provider            text,
  provider_tx_id      text,
  provider_ref        text,
  payment_type        text,
  card_brand          text,
  card_last4          text,
  card_issuer         text,
  processor_response  text,
  months              integer,
  covers_from         date,
  covers_until        date
)language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;
  return query select * from private.dues_payment_rows(p_estate_id, p_since, p_until, p_limit);
end;
$$;

revoke execute on function public.operator_dues_payments(uuid, timestamptz, timestamptz, integer)
  from public, anon;
grant  execute on function public.operator_dues_payments(uuid, timestamptz, timestamptz, integer)
  to authenticated;

create function public.estate_dues_payments(
  p_estate_id uuid,
  p_since     timestamptz default null,
  p_until     timestamptz default null,
  p_limit     integer     default 2000
)
returns table (
  payment_id          uuid,
  created_at          timestamptz,
  settled_at          timestamptz,
  status              text,
  estate_id           uuid,
  estate_name         text,
  house_number        text,
  charge_id           uuid,
  charge_period       date,
  charge_due_on       date,
  charge_status       text,
  billed_to           text,
  billed_name         text,
  payer_name          text,
  payer_email         text,
  payer_phone         text,
  paid_via            text,
  amount_minor        bigint,
  currency            text,
  charged_minor       bigint,
  provider_fee_minor  bigint,
  settled_minor       bigint,
  platform_fee_percent numeric,
  platform_fee_minor  bigint,
  tx_ref              text,
  provider            text,
  provider_tx_id      text,
  provider_ref        text,
  payment_type        text,
  card_brand          text,
  card_last4          text,
  card_issuer         text,
  processor_response  text,
  months              integer,
  covers_from         date,
  covers_until        date
)language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_estate_id is null or public.current_membership(p_estate_id, 'admin') is null then
    raise exception 'not_an_estate_admin' using errcode = '42501';
  end if;
  return query select * from private.dues_payment_rows(p_estate_id, p_since, p_until, p_limit);
end;
$$;

revoke execute on function public.estate_dues_payments(uuid, timestamptz, timestamptz, integer)
  from public, anon;
grant  execute on function public.estate_dues_payments(uuid, timestamptz, timestamptz, integer)
  to authenticated;
