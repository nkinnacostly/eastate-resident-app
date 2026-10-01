-- Estate Access Platform — estate admins see their own estate's dues payments
--
-- The operator ledger (20261001100000) showed every dues payment on the
-- platform. An estate admin needs the same detail for THEIR estate: every
-- resident's and every landlord's payment, failed attempts included.
--
-- The query moves into private helpers so both dashboards read one definition.
-- Two copies of a money query drift, and the drift is a reconciliation dispute.
--
-- The helpers are NOT security definer and are not callable by any API role:
-- they run with the rights of the definer RPC that calls them, and that RPC is
-- the only place authority is decided.

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
  processor_response  text
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
    nullif(p.raw_payload ->> 'processor_response', '')
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

create function private.dues_totals_rows(
  p_estate_id uuid        default null,
  p_since     timestamptz default null,
  p_until     timestamptz default null
)
returns table (
  estate_id           uuid,
  estate_name         text,
  currency            text,
  payments            integer,
  failed              integer,
  collected_minor     bigint,
  platform_fee_minor  bigint,
  payers              integer,
  outstanding_minor   bigint,
  open_charges        integer,
  last_payment_at     timestamptz
)
language plpgsql
stable
set search_path = ''
as $$
begin
  return query
  with pay as (
    select c.estate_id, p.currency, p.status, p.amount_minor, p.platform_fee_percent,
           p.created_at, p.settled_at,
           coalesce(c.membership_id::text, c.house_id::text) as subject
      from public.dues_payments p
      join public.dues_charges c on c.id = p.charge_id
     where (p_estate_id is null or c.estate_id = p_estate_id)
       and (p_since is null or p.created_at >= p_since)
       and (p_until is null or p.created_at <  p_until)
  ),
  paid as (
    select pay.estate_id, pay.currency,
           count(*) filter (where pay.status = 'successful')::integer        as payments,
           count(*) filter (where pay.status = 'failed')::integer            as failed,
           coalesce(sum(pay.amount_minor) filter (where pay.status = 'successful'), 0)::bigint
                                                                              as collected,
           coalesce(sum(round(pay.amount_minor * pay.platform_fee_percent))
                      filter (where pay.status = 'successful'), 0)::bigint   as fee,
           count(distinct pay.subject) filter (where pay.status = 'successful')::integer
                                                                              as payers,
           max(pay.settled_at) filter (where pay.status = 'successful')      as last_at
      from pay
     group by pay.estate_id, pay.currency
  ),
  owed as (
    -- Outstanding is a balance NOW, not a figure for the window.
    select c.estate_id, c.currency,
           sum(c.amount_minor)::bigint as outstanding, count(*)::integer as open_n
      from public.dues_charges c
     where c.status = 'open'
       and (p_estate_id is null or c.estate_id = p_estate_id)
     group by c.estate_id, c.currency
  )
  select e.id, e.name, coalesce(paid.currency, owed.currency),
         coalesce(paid.payments, 0), coalesce(paid.failed, 0),
         coalesce(paid.collected, 0), coalesce(paid.fee, 0), coalesce(paid.payers, 0),
         coalesce(owed.outstanding, 0), coalesce(owed.open_n, 0),
         paid.last_at
    from paid
    full join owed on owed.estate_id = paid.estate_id and owed.currency = paid.currency
    join public.estates e on e.id = coalesce(paid.estate_id, owed.estate_id)
   order by coalesce(paid.collected, 0) desc, e.name;
end;
$$;

revoke execute on function private.dues_totals_rows(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ─── The operator RPCs, now delegating ───────────────────────────────────────

create or replace function public.operator_dues_payments(
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
  processor_response  text
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

create or replace function public.operator_dues_by_estate(
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns table (
  estate_id           uuid,
  estate_name         text,
  currency            text,
  payments            integer,
  failed              integer,
  collected_minor     bigint,
  platform_fee_minor  bigint,
  payers              integer,
  outstanding_minor   bigint,
  open_charges        integer,
  last_payment_at     timestamptz
)language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;
  return query select * from private.dues_totals_rows(null, p_since, p_until);
end;
$$;

-- ─── The estate admin's view ─────────────────────────────────────────────────
--
-- p_estate_id is client-supplied, so it proves nothing on its own: the caller
-- must hold an ACTIVE admin membership at that estate, resolved from auth.uid().
-- It is required, never defaulted to null -- in the helper, null means "every
-- estate", and an admin must not be one missing argument away from that.

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
  processor_response  text
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

create function public.estate_dues_totals(
  p_estate_id uuid,
  p_since     timestamptz default null,
  p_until     timestamptz default null
)
returns table (
  estate_id           uuid,
  estate_name         text,
  currency            text,
  payments            integer,
  failed              integer,
  collected_minor     bigint,
  platform_fee_minor  bigint,
  payers              integer,
  outstanding_minor   bigint,
  open_charges        integer,
  last_payment_at     timestamptz
)language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_estate_id is null or public.current_membership(p_estate_id, 'admin') is null then
    raise exception 'not_an_estate_admin' using errcode = '42501';
  end if;
  return query select * from private.dues_totals_rows(p_estate_id, p_since, p_until);
end;
$$;

revoke execute on function public.estate_dues_totals(uuid, timestamptz, timestamptz)
  from public, anon;
grant  execute on function public.estate_dues_totals(uuid, timestamptz, timestamptz)
  to authenticated;
