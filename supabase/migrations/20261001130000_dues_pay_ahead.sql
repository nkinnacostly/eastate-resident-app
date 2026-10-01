-- Estate Access Platform — paying dues ahead: quarterly, half-yearly, yearly
--
-- A payer can settle 1, 3, 6 or 12 months in one checkout. Dues STAY MONTHLY:
-- the charge row is still one month, so reminders, the gate's arrears check,
-- the admin's ledger and the monthly generator need no notion of a "term".
-- Paying ahead simply means future months' charges come into existence already
-- paid, and the generator's ON CONFLICT DO NOTHING then skips them.
--
-- No discount: N months cost the sum of N monthly amounts. A product decision,
-- recorded here so the absence is not mistaken for an oversight.
--
-- ─── The plan, frozen at checkout ────────────────────────────────────────────
--
-- When the checkout is built we decide exactly which months it covers and what
-- each costs, and store that list. Settlement then follows the list rather than
-- re-deriving it, for the same reason amount_minor is frozen on the payment: an
-- admin changing the rate, or the cron raising next month, between "pay" and
-- the webhook must not change what the customer bought.
--
-- Which months: the NEXT N UNPAID months starting at the charge the payer
-- pressed, skipping any already paid or waived. Paying a year from January when
-- March was waived covers January to January, not eleven months and a waiver.
--
-- What is deliberately NOT handled, and why:
--   * Refunds. A resident who prepays a year and moves out in month four has
--     paid for months they will not live there. That is between them and the
--     estate; the ledger shows exactly which months were covered.
--   * A house whose payer changes from landlord to residents after a prepaid
--     year. The prepaid house charges stand and the residents are billed too.
--     The admin can waive the duplicates; guessing which to cancel is worse.

-- ─── Schema ──────────────────────────────────────────────────────────────────

alter table public.dues_payments
  add column months integer not null default 1;
alter table public.dues_payments
  add constraint dues_payments_months_ck check (months in (1, 3, 6, 12));

create table public.dues_payment_periods (
  payment_id   uuid not null references public.dues_payments (id) on delete cascade,
  period       date not null,
  amount_minor bigint not null check (amount_minor > 0),
  -- Null until settlement for a month whose charge did not exist yet. Filled
  -- with the charge the payment created or settled, so the ledger can always
  -- say which charge rows a payment paid for.
  charge_id    uuid references public.dues_charges (id) on delete set null,
  primary key (payment_id, period)
);

comment on table public.dues_payment_periods is
  'Which months a payment covers, frozen when the checkout was built. Settlement '
  'follows this list; it never re-derives it.';

-- Internal bookkeeping. RLS on with no policy and no grant: the only readers
-- are the definer ledger functions, and the only writer is the start/settle
-- path. Matching access_codes, a missing write policy is what keeps it so.
alter table public.dues_payment_periods enable row level security;

-- ─── Planning ────────────────────────────────────────────────────────────────

create function private.dues_plan(p_charge_id uuid, p_months integer)
returns table (period date, amount_minor bigint, charge_id uuid)
language plpgsql
stable
set search_path = ''
as $$
declare
  c        public.dues_charges%rowtype;
  e        public.estates%rowtype;
  v_house  uuid;
  v_rate   bigint;
  v_found  integer := 0;
  v_period date;
  x        public.dues_charges%rowtype;
begin
  select * into c from public.dues_charges where id = p_charge_id;
  if c.id is null or c.status <> 'open' then return; end if;
  select * into e from public.estates where id = c.estate_id;

  -- The rate a month that does not exist YET would be raised at -- the same
  -- terms generate_dues_charges uses, so a prepaid month costs what the
  -- generator would have charged for it.
  if c.house_id is not null then
    select t.amount_minor into v_rate
      from public.house_dues_terms(c.house_id) t
     where t.payer = 'landlord' and t.currency = c.currency;
  else
    select m.house_id into v_house from public.memberships m
     where m.id = c.membership_id and m.is_active;
    if v_house is not null then
      select t.amount_minor into v_rate
        from public.house_dues_terms(v_house) t
       where t.payer = 'residents' and t.currency = c.currency;
    elsif e.dues_billing_mode = 'per_resident' and e.dues_currency = c.currency then
      v_rate := e.dues_amount_minor;
    end if;
  end if;

  -- Bounded walk: N unpaid months within the next two years. Without a bound a
  -- subject with many waived months would make this loop open-ended.
  for i in 0 .. 23 loop
    exit when v_found >= p_months;
    v_period := (c.period + make_interval(months => i))::date;

    select * into x from public.dues_charges d
     where d.estate_id = c.estate_id and d.period = v_period
       and ((c.house_id is not null and d.house_id = c.house_id)
         or (c.membership_id is not null and d.membership_id = c.membership_id));

    if x.id is not null then
      if x.status = 'open' then
        period := v_period; amount_minor := x.amount_minor; charge_id := x.id;
        return next;
        v_found := v_found + 1;
      end if;
      -- paid or waived: skipped, and does not count towards N
    else
      -- No rate means the subject is no longer billed on these terms (estate
      -- switched dues off, resident moved out). Stop: the caller sees fewer
      -- than N months and refuses, rather than selling months nobody would
      -- ever have been charged for.
      exit when v_rate is null;
      period := v_period; amount_minor := v_rate; charge_id := null;
      return next;
      v_found := v_found + 1;
    end if;
  end loop;
end;
$$;

revoke execute on function private.dues_plan(uuid, integer) from public, anon, authenticated;

-- Shared by the three start paths: validate the term, freeze the plan, and
-- return the payment's id and total. Returns a reason instead when it cannot.
create function private.claim_dues_payment(
  p_charge_id   uuid,
  p_months      integer,
  p_membership  uuid,
  p_payer_email text,
  out ok           boolean,
  out reason       text,
  out tx_ref       text,
  out amount_minor bigint,
  out currency     text,
  out covers_from  date,
  out covers_until date
)
language plpgsql
volatile
set search_path = ''
as $$
declare
  c       public.dues_charges%rowtype;
  v_n     integer;
  v_total bigint;
  v_id    uuid;
begin
  ok := false;
  if p_months is null or p_months not in (1, 3, 6, 12) then
    reason := 'invalid_term'; return;
  end if;

  select * into c from public.dues_charges where id = p_charge_id;

  select count(*), sum(pl.amount_minor), min(pl.period), max(pl.period)
    into v_n, v_total, covers_from, covers_until
    from private.dues_plan(p_charge_id, p_months) pl;

  if v_n < p_months then
    covers_from := null; covers_until := null;
    reason := 'cannot_pay_ahead'; return;
  end if;

  tx_ref := 'dues-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.dues_payments
    (charge_id, tx_ref, amount_minor, currency, initiated_by_membership_id, payer_email, months)
  values
    (c.id, tx_ref, v_total, c.currency, p_membership,
     nullif(btrim(coalesce(p_payer_email, '')), ''), p_months)
  returning id into v_id;

  insert into public.dues_payment_periods (payment_id, period, amount_minor, charge_id)
  select v_id, pl.period, pl.amount_minor, pl.charge_id
    from private.dues_plan(p_charge_id, p_months) pl;

  ok := true; amount_minor := v_total; currency := c.currency;
end;
$$;

revoke execute on function private.claim_dues_payment(uuid, integer, uuid, text)
  from public, anon, authenticated;

-- ─── The three start paths, now taking a term ────────────────────────────────
--
-- DROPPED and recreated, not overloaded. A second signature with a defaulted
-- p_months would make every existing one-argument call ambiguous, and
-- PostgREST would refuse it outright.

drop function public.start_dues_payment(uuid);

create function public.start_dues_payment(p_charge_id uuid, p_months integer default 1)
returns table (ok boolean, reason text, tx_ref text, amount_minor bigint, currency text,
               subaccount_ref text, fee_percent numeric,
               months integer, covers_from date, covers_until date)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c            public.dues_charges%rowtype;
  v_membership uuid;
  v_email      text;
  v_sub        text;
  v_fee        numeric;
  r            record;
begin
  select * into c from public.dues_charges where id = p_charge_id;
  if c.id is null then
    return query select false, 'no_such_charge'::text, null::text, null::bigint, null::text,
                        null::text, null::numeric, null::integer, null::date, null::date;
    return;
  end if;

  v_membership := public.current_membership(c.estate_id, 'resident');
  if v_membership is null then
    return query select false, 'not_a_resident'::text, null::text, null::bigint, null::text,
                        null::text, null::numeric, null::integer, null::date, null::date;
    return;
  end if;

  if not (
    (c.membership_id is not null and c.membership_id = v_membership)
    or (c.house_id is not null and c.house_id = (
          select m.house_id from public.memberships m where m.id = v_membership))
  ) then
    return query select false, 'not_your_charge'::text, null::text, null::bigint, null::text,
                        null::text, null::numeric, null::integer, null::date, null::date;
    return;
  end if;

  if c.status <> 'open' then
    return query select false, 'charge_not_open'::text, null::text, null::bigint, null::text,
                        null::text, null::numeric, null::integer, null::date, null::date;
    return;
  end if;

  select e.settlement_subaccount_ref, e.platform_fee_percent
    into v_sub, v_fee
    from public.estates e where e.id = c.estate_id;

  if v_sub is null then
    return query select false, 'estate_has_no_settlement_account'::text, null::text,
                        null::bigint, null::text, null::text, null::numeric,
                        null::integer, null::date, null::date;
    return;
  end if;

  select u.email into v_email
    from public.memberships m join auth.users u on u.id = m.user_id
   where m.id = v_membership;

  select * into r from private.claim_dues_payment(c.id, p_months, v_membership, v_email);
  if not r.ok then
    return query select false, r.reason, null::text, null::bigint, null::text,
                        null::text, null::numeric, null::integer, null::date, null::date;
    return;
  end if;

  return query select true, null::text, r.tx_ref, r.amount_minor, r.currency,
                      v_sub, coalesce(v_fee, 0), p_months, r.covers_from, r.covers_until;
end;
$$;

revoke execute on function public.start_dues_payment(uuid, integer) from public, anon;
grant  execute on function public.start_dues_payment(uuid, integer) to authenticated;

drop function public.start_dues_payment_by_token(text, text);

create function public.start_dues_payment_by_token(
  p_pay_token text, p_payer_email text, p_months integer default 1
)
returns table (ok boolean, reason text, tx_ref text, amount_minor bigint, currency text,
               estate_name text, house_number text,
               subaccount_ref text, fee_percent numeric,
               months integer, covers_from date, covers_until date)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c        public.dues_charges%rowtype;
  v_estate text;
  v_house  text;
  v_sub    text;
  v_fee    numeric;
  r        record;
begin
  select * into c from public.dues_charges where pay_token = p_pay_token;
  if c.id is null then
    return query select false, 'no_such_charge'::text, null::text, null::bigint, null::text,
                        null::text, null::text, null::text, null::numeric,
                        null::integer, null::date, null::date;
    return;
  end if;

  if c.status <> 'open' then
    return query select false, 'charge_not_open'::text, null::text, null::bigint, null::text,
                        null::text, null::text, null::text, null::numeric,
                        null::integer, null::date, null::date;
    return;
  end if;

  select e.name, e.settlement_subaccount_ref, e.platform_fee_percent
    into v_estate, v_sub, v_fee
    from public.estates e where e.id = c.estate_id;

  if v_sub is null then
    return query select false, 'estate_has_no_settlement_account'::text, null::text,
                        null::bigint, null::text, null::text, null::text, null::text, null::numeric,
                        null::integer, null::date, null::date;
    return;
  end if;

  select h.house_number into v_house from public.houses h where h.id = c.house_id;

  select * into r from private.claim_dues_payment(c.id, p_months, null, p_payer_email);
  if not r.ok then
    return query select false, r.reason, null::text, null::bigint, null::text,
                        null::text, null::text, null::text, null::numeric,
                        null::integer, null::date, null::date;
    return;
  end if;

  return query select true, null::text, r.tx_ref, r.amount_minor, r.currency, v_estate, v_house,
                      v_sub, coalesce(v_fee, 0), p_months, r.covers_from, r.covers_until;
end;
$$;

revoke execute on function public.start_dues_payment_by_token(text, text, integer)
  from public, anon, authenticated;

drop function public.start_landlord_dues_payment(uuid);

create function public.start_landlord_dues_payment(p_charge_id uuid, p_months integer default 1)
returns table (ok boolean, reason text, tx_ref text, amount_minor bigint, currency text,
               subaccount_ref text, fee_percent numeric,
               months integer, covers_from date, covers_until date)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c       public.dues_charges%rowtype;
  v_email text := public.current_verified_email();
  v_sub   text;
  v_fee   numeric;
  v_owns  boolean;
  r       record;
begin
  if v_email is null then
    return query select false, 'email_not_confirmed'::text, null::text, null::bigint,
                        null::text, null::text, null::numeric, null::integer, null::date, null::date;
    return;
  end if;

  select * into c from public.dues_charges where id = p_charge_id;
  if c.id is null then
    return query select false, 'no_such_charge'::text, null::text, null::bigint,
                        null::text, null::text, null::numeric, null::integer, null::date, null::date;
    return;
  end if;

  -- Theirs, and a HOUSE charge -- see 20260928100000.
  select exists (
    select 1 from public.houses h
     where h.id = c.house_id
       and lower(btrim(h.landlord_email)) = v_email
  ) into v_owns;

  if c.house_id is null or not v_owns then
    return query select false, 'not_your_charge'::text, null::text, null::bigint,
                        null::text, null::text, null::numeric, null::integer, null::date, null::date;
    return;
  end if;

  if c.status <> 'open' then
    return query select false, 'charge_not_open'::text, null::text, null::bigint,
                        null::text, null::text, null::numeric, null::integer, null::date, null::date;
    return;
  end if;

  select e.settlement_subaccount_ref, e.platform_fee_percent
    into v_sub, v_fee
    from public.estates e where e.id = c.estate_id;

  if v_sub is null then
    return query select false, 'estate_has_no_settlement_account'::text, null::text,
                        null::bigint, null::text, null::text, null::numeric,
                        null::integer, null::date, null::date;
    return;
  end if;

  select * into r from private.claim_dues_payment(c.id, p_months, null, v_email);
  if not r.ok then
    return query select false, r.reason, null::text, null::bigint, null::text,
                        null::text, null::numeric, null::integer, null::date, null::date;
    return;
  end if;

  return query select true, null::text, r.tx_ref, r.amount_minor, r.currency,
                      v_sub, coalesce(v_fee, 0), p_months, r.covers_from, r.covers_until;
end;
$$;

revoke execute on function public.start_landlord_dues_payment(uuid, integer) from public, anon;
grant  execute on function public.start_landlord_dues_payment(uuid, integer) to authenticated;

-- ─── Settlement follows the plan ─────────────────────────────────────────────
--
-- Same signature, same idempotency and checks as 20260927120000 -- only the
-- last step changes, from "mark the one charge paid" to "mark every planned
-- month paid". A payment with no plan rows (started before this migration)
-- takes the old single-charge path.

create or replace function public.settle_dues_payment(
  p_tx_ref          text,
  p_provider_tx_id  text,
  p_amount_minor    bigint,
  p_currency        text,
  p_provider_status text,
  p_raw             jsonb
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p          public.dues_payments%rowtype;
  anchor     public.dues_charges%rowtype;
  pl         record;
  v_rows     integer;
  v_charge   uuid;
  v_grace    integer;
  v_any_dup  boolean := false;
begin
  select * into p from public.dues_payments where tx_ref = p_tx_ref;
  if p.id is null then
    return 'unknown_reference';
  end if;

  -- Idempotency before anything is decided. See 20260927120000.
  if p.status = 'successful' then
    return 'already_settled';
  end if;

  if lower(coalesce(p_provider_status, '')) <> 'successful' then
    update public.dues_payments
       set status = 'failed', raw_payload = p_raw, settled_at = now(),
           provider_tx_id = coalesce(p_provider_tx_id, provider_tx_id)
     where id = p.id and status = 'initiated';
    return 'recorded_failure';
  end if;

  if upper(coalesce(p_currency, '')) <> upper(p.currency) then
    update public.dues_payments set raw_payload = p_raw where id = p.id;
    return 'currency_mismatch';
  end if;

  -- Against the frozen TOTAL for every month in the plan, so a year's checkout
  -- underpaid by one month's worth is refused, not quietly settled for eleven.
  if p_amount_minor < p.amount_minor then
    update public.dues_payments set raw_payload = p_raw where id = p.id;
    return 'amount_mismatch';
  end if;

  -- THE CLAIM: exactly one caller wins.
  update public.dues_payments
     set status = 'successful', provider_tx_id = p_provider_tx_id,
         raw_payload = p_raw, settled_at = now()
   where id = p.id and status <> 'successful';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'already_settled';
  end if;

  if not exists (select 1 from public.dues_payment_periods where payment_id = p.id) then
    -- Started before pay-ahead existed: one charge, exactly as before.
    update public.dues_charges
       set status = 'paid', paid_at = now()
     where id = p.charge_id and status = 'open';
    get diagnostics v_rows = row_count;
    return case when v_rows = 1 then 'settled' else 'settled_charge_already_paid' end;
  end if;

  select * into anchor from public.dues_charges where id = p.charge_id;
  select e.dues_grace_days into v_grace from public.estates e where e.id = anchor.estate_id;

  for pl in
    select * from public.dues_payment_periods where payment_id = p.id order by period
  loop
    v_charge := pl.charge_id;

    if v_charge is null then
      -- A month that had no charge when the checkout was built. Create it
      -- already paid, at the frozen amount. If the generator raised it in the
      -- meantime the insert conflicts and we settle that row instead.
      insert into public.dues_charges
        (estate_id, period, house_id, membership_id, amount_minor, currency, due_on,
         status, paid_at)
      values
        (anchor.estate_id, pl.period, anchor.house_id, anchor.membership_id,
         pl.amount_minor, p.currency, pl.period + coalesce(v_grace, 0),
         'paid', now())
      on conflict do nothing
      returning id into v_charge;

      if v_charge is null then
        select d.id into v_charge from public.dues_charges d
         where d.estate_id = anchor.estate_id and d.period = pl.period
           and ((anchor.house_id is not null and d.house_id = anchor.house_id)
             or (anchor.membership_id is not null and d.membership_id = anchor.membership_id));
        update public.dues_charges set status = 'paid', paid_at = now()
         where id = v_charge and status = 'open';
        get diagnostics v_rows = row_count;
        if v_rows = 0 then v_any_dup := true; end if;
      end if;

      update public.dues_payment_periods set charge_id = v_charge
       where payment_id = p.id and period = pl.period;
    else
      -- Conditional, as before: a month paid by a different attempt meanwhile
      -- is not paid twice. The money is real; the row says so.
      update public.dues_charges set status = 'paid', paid_at = now()
       where id = v_charge and status = 'open';
      get diagnostics v_rows = row_count;
      if v_rows = 0 then v_any_dup := true; end if;
    end if;
  end loop;

  return case when v_any_dup then 'settled_charge_already_paid' else 'settled' end;
end;
$$;

revoke execute on function public.settle_dues_payment(text, text, bigint, text, text, jsonb)
  from public, anon, authenticated;
