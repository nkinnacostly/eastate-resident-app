-- Estate Access Platform — carry the split through to the checkout
--
-- 20260927190000 recorded WHERE an estate's money goes. This carries it into
-- the payment itself: the two functions that start a payment now hand the
-- caller the estate's subaccount and commission rate, so the Edge Function can
-- attach the split to the charge.
--
-- Returned from the database rather than looked up by the Edge Function for
-- one reason: it arrives in the same statement, from the same charge row, as
-- the amount. A second round trip is a second chance to read a different
-- estate's settlement details than the one the charge belongs to.
--
-- Neither value reaches the client. The Edge Function puts them in the
-- Flutterwave request and returns only the link -- a resident has no use for
-- the estate's payout reference, and our commission rate is not their business.

-- ─── A clearer refusal than the table constraint gives ───────────────────────
--
-- estates_dues_need_settlement_ck already makes "billing with nowhere to
-- settle" unrepresentable. This exists so the admin reads "add your estate's
-- bank account first" instead of a constraint name.

create or replace function public.set_dues_config(
  p_estate_id    uuid,
  p_billing_mode public.dues_billing_mode,
  p_amount_minor bigint  default null,
  p_currency     text    default null,
  p_grace_days   integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.current_membership(p_estate_id, 'admin');
  v_sub   text;
  v_scountry text;
begin
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if p_billing_mode <> 'none' then
    if p_amount_minor is null or p_amount_minor <= 0 then
      raise exception 'dues_amount_required' using errcode = '22023';
    end if;
    if p_currency is null or p_currency not in ('NGN', 'ZAR') then
      raise exception 'unsupported_currency' using errcode = '22023';
    end if;

    select settlement_subaccount_ref, settlement_country
      into v_sub, v_scountry
      from public.estates where id = p_estate_id;

    -- The money has to have somewhere to go before anyone is billed. Charging
    -- residents into a platform balance is the thing 20260927190000 exists to
    -- prevent, and the quiet way to arrive there is to let dues be switched on
    -- first and the bank details be added "later".
    if v_sub is null then
      raise exception 'settlement_account_required' using errcode = '22023';
    end if;

    -- An NG account cannot receive rand and a ZA one cannot receive
    -- naira. Caught here rather than at the gateway, where it would
    -- surface as a failed payment for a resident who did nothing wrong.
    if (p_currency = 'NGN' and v_scountry <> 'NG')
       or (p_currency = 'ZAR' and v_scountry <> 'ZA') then
      raise exception 'currency_does_not_match_settlement_account' using errcode = '22023';
    end if;
  end if;

  update public.estates
     set dues_billing_mode = p_billing_mode,
         dues_amount_minor = case when p_billing_mode = 'none' then null else p_amount_minor end,
         dues_currency     = case when p_billing_mode = 'none' then null else p_currency end,
         dues_grace_days   = coalesce(p_grace_days, dues_grace_days)
   where id = p_estate_id;

  if not found then
    raise exception 'no_such_estate' using errcode = '42704';
  end if;
end;
$$;

revoke execute on function public.set_dues_config(uuid, public.dues_billing_mode, bigint, text, integer)
  from public, anon;
grant execute on function public.set_dues_config(uuid, public.dues_billing_mode, bigint, text, integer)
  to authenticated;

-- ─── Starting a payment, with the destination attached ───────────────────────

drop function if exists public.start_dues_payment(uuid);

create function public.start_dues_payment(p_charge_id uuid)
returns table (ok boolean, reason text, tx_ref text, amount_minor bigint, currency text,
               subaccount_ref text, fee_percent numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c            public.dues_charges%rowtype;
  v_membership uuid;
  v_email      text;
  v_ref        text;
  v_sub        text;
  v_fee        numeric;
begin
  select * into c from public.dues_charges where id = p_charge_id;
  if c.id is null then
    return query select false, 'no_such_charge'::text, null::text, null::bigint, null::text,
                        null::text, null::numeric;
    return;
  end if;

  v_membership := public.current_membership(c.estate_id, 'resident');
  if v_membership is null then
    return query select false, 'not_a_resident'::text, null::text, null::bigint, null::text,
                        null::text, null::numeric;
    return;
  end if;

  if not (
    (c.membership_id is not null and c.membership_id = v_membership)
    or (c.house_id is not null and c.house_id = (
          select m.house_id from public.memberships m where m.id = v_membership))
  ) then
    return query select false, 'not_your_charge'::text, null::text, null::bigint, null::text,
                        null::text, null::numeric;
    return;
  end if;

  if c.status <> 'open' then
    return query select false, 'charge_not_open'::text, null::text, null::bigint, null::text,
                        null::text, null::numeric;
    return;
  end if;

  select e.settlement_subaccount_ref, e.platform_fee_percent
    into v_sub, v_fee
    from public.estates e where e.id = c.estate_id;

  -- Belt and braces over the table constraint. A charge can outlive the
  -- configuration that raised it -- an estate could clear its settlement
  -- details while last month's charges are still open -- and taking money with
  -- nowhere to send it is worse than refusing it.
  if v_sub is null then
    return query select false, 'estate_has_no_settlement_account'::text, null::text,
                        null::bigint, null::text, null::text, null::numeric;
    return;
  end if;

  select u.email into v_email
    from public.memberships m join auth.users u on u.id = m.user_id
   where m.id = v_membership;

  v_ref := 'dues-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.dues_payments
    (charge_id, tx_ref, amount_minor, currency, initiated_by_membership_id, payer_email)
  values
    (c.id, v_ref, c.amount_minor, c.currency, v_membership, v_email);

  return query select true, null::text, v_ref, c.amount_minor, c.currency,
                      v_sub, coalesce(v_fee, 0);
end;
$$;

revoke execute on function public.start_dues_payment(uuid) from public, anon;
grant  execute on function public.start_dues_payment(uuid) to authenticated;

-- ─── ...and the same for the landlord's link ─────────────────────────────────

drop function if exists public.start_dues_payment_by_token(text, text);

create function public.start_dues_payment_by_token(p_pay_token text, p_payer_email text)
returns table (ok boolean, reason text, tx_ref text, amount_minor bigint, currency text,
               estate_name text, house_number text,
               subaccount_ref text, fee_percent numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c        public.dues_charges%rowtype;
  v_ref    text;
  v_estate text;
  v_house  text;
  v_sub    text;
  v_fee    numeric;
begin
  select * into c from public.dues_charges where pay_token = p_pay_token;
  if c.id is null then
    return query select false, 'no_such_charge'::text, null::text, null::bigint, null::text,
                        null::text, null::text, null::text, null::numeric;
    return;
  end if;

  if c.status <> 'open' then
    return query select false, 'charge_not_open'::text, null::text, null::bigint, null::text,
                        null::text, null::text, null::text, null::numeric;
    return;
  end if;

  select e.name, e.settlement_subaccount_ref, e.platform_fee_percent
    into v_estate, v_sub, v_fee
    from public.estates e where e.id = c.estate_id;

  if v_sub is null then
    return query select false, 'estate_has_no_settlement_account'::text, null::text,
                        null::bigint, null::text, null::text, null::text, null::text, null::numeric;
    return;
  end if;

  select h.house_number into v_house from public.houses h where h.id = c.house_id;

  v_ref := 'dues-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.dues_payments
    (charge_id, tx_ref, amount_minor, currency, payer_email)
  values
    (c.id, v_ref, c.amount_minor, c.currency, nullif(btrim(coalesce(p_payer_email,'')), ''));

  return query select true, null::text, v_ref, c.amount_minor, c.currency, v_estate, v_house,
                      v_sub, coalesce(v_fee, 0);
end;
$$;

revoke execute on function public.start_dues_payment_by_token(text, text)
  from public, anon, authenticated;
