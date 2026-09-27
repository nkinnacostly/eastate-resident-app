-- Estate Access Platform — the payment lifecycle
--
-- Flutterwave v3 has no idempotency header. Their docs say so by omission and
-- their own guidance fills the gap: "Occasionally, we might send the same
-- webhook event more than once. You should make your event processing
-- idempotent... so you don't end up giving a customer value multiple times."
--
-- So `tx_ref` plays exactly the role `client_event_id` plays for offline
-- verification: it is OUR reference, claimed before anything else happens, and
-- claimed once. The settlement below is the burn -- a conditional UPDATE that
-- can only fire on a row not already settled -- and the same rule applies as at
-- the gate: dedupe BEFORE deciding anything, or a retried webhook after a lost
-- acknowledgement looks like a second payment.
--
-- Two independent paths report the same payment: the browser returning to our
-- redirect_url, and the webhook. They race, routinely. Everything here is built
-- so that whichever arrives first wins and the second is a no-op.

-- ─── Claiming a reference ────────────────────────────────────────────────────

create function public.start_dues_payment(p_charge_id uuid)
returns table (ok boolean, reason text, tx_ref text, amount_minor bigint, currency text)
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
begin
  select * into c from public.dues_charges where id = p_charge_id;
  if c.id is null then
    return query select false, 'no_such_charge'::text, null::text, null::bigint, null::text;
    return;
  end if;

  -- Identity from auth.uid(), never an argument. p_charge_id is client-supplied
  -- and therefore proves nothing: without this a resident of estate A could
  -- name a charge at estate B and start a payment against it.
  v_membership := public.current_membership(c.estate_id, 'resident');
  if v_membership is null then
    return query select false, 'not_a_resident'::text, null::text, null::bigint, null::text;
    return;
  end if;

  -- ...and being a resident of the estate is still not enough. The charge must
  -- actually be one that covers THIS person, or a resident could pay down a
  -- neighbour's balance, which is a way to learn what a neighbour owes.
  if not (
    (c.membership_id is not null and c.membership_id = v_membership)
    or (c.house_id is not null and c.house_id = (
          select m.house_id from public.memberships m where m.id = v_membership))
  ) then
    return query select false, 'not_your_charge'::text, null::text, null::bigint, null::text;
    return;
  end if;

  if c.status <> 'open' then
    return query select false, 'charge_not_open'::text, null::text, null::bigint, null::text;
    return;
  end if;

  select u.email into v_email
    from public.memberships m join auth.users u on u.id = m.user_id
   where m.id = v_membership;

  -- Alphanumeric and hyphens only. v3 does not constrain the format, but v4
  -- does (^[a-zA-Z0-9\-]+$, 6-42 chars) and matching it now means the
  -- references we are generating today survive that migration untouched.
  v_ref := 'dues-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.dues_payments
    (charge_id, tx_ref, amount_minor, currency, initiated_by_membership_id, payer_email)
  values
    (c.id, v_ref, c.amount_minor, c.currency, v_membership, v_email);

  return query select true, null::text, v_ref, c.amount_minor, c.currency;
end;
$$;

revoke execute on function public.start_dues_payment(uuid) from public, anon;
grant  execute on function public.start_dues_payment(uuid) to authenticated;

-- ─── Claiming a reference from a pay link ────────────────────────────────────
--
-- The landlord path, and the reason the pay token exists. There is no
-- auth.uid() here because there is no account -- `houses` stores the landlord
-- as name/phone/email and says outright that they never sign in.
--
-- The token IS the authorisation, which is not a weakening of the identity rule
-- but a different kind of claim: a bearer capability over one charge, rather
-- than an assertion about who the caller is. It authorises nothing except
-- paying a specific bill, and paying somebody's bill is not an attack.
-- service_role only, so it is reachable solely from the Edge Function that
-- received the token.

create function public.start_dues_payment_by_token(p_pay_token text, p_payer_email text)
returns table (ok boolean, reason text, tx_ref text, amount_minor bigint, currency text,
               estate_name text, house_number text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c      public.dues_charges%rowtype;
  v_ref  text;
  v_estate text;
  v_house  text;
begin
  select * into c from public.dues_charges where pay_token = p_pay_token;
  if c.id is null then
    return query select false, 'no_such_charge'::text, null::text, null::bigint, null::text,
                        null::text, null::text;
    return;
  end if;

  if c.status <> 'open' then
    return query select false, 'charge_not_open'::text, null::text, null::bigint, null::text,
                        null::text, null::text;
    return;
  end if;

  select e.name into v_estate from public.estates e where e.id = c.estate_id;
  select h.house_number into v_house from public.houses h where h.id = c.house_id;

  v_ref := 'dues-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.dues_payments
    (charge_id, tx_ref, amount_minor, currency, payer_email)
  values
    (c.id, v_ref, c.amount_minor, c.currency, nullif(btrim(coalesce(p_payer_email,'')), ''));

  return query select true, null::text, v_ref, c.amount_minor, c.currency, v_estate, v_house;
end;
$$;

revoke execute on function public.start_dues_payment_by_token(text, text)
  from public, anon, authenticated;

-- ─── Settlement ──────────────────────────────────────────────────────────────
--
-- Called by the webhook AND by the redirect handler, concurrently, for the same
-- payment. Both arrive only AFTER the caller has re-verified against
-- Flutterwave's verify endpoint -- their own instruction, and not optional:
-- v3's `verif-hash` is a static shared secret echoed in a header, not a
-- signature over the payload, so it proves nothing about what the payload says.
-- The re-verify call is the actual security control.
--
-- The amount and currency here are what Flutterwave REPORTED. They are checked
-- again against what we recorded when the reference was claimed, because a
-- caller that skipped its own check must not be the only thing standing between
-- a tampered amount and a settled charge.

create function public.settle_dues_payment(
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
  p        public.dues_payments%rowtype;
  v_rows   integer;
begin
  select * into p from public.dues_payments where tx_ref = p_tx_ref;
  if p.id is null then
    -- A reference we never issued. Recorded nowhere and given no value: this is
    -- either a misrouted webhook or someone guessing.
    return 'unknown_reference';
  end if;

  -- IDEMPOTENCY, checked before anything is decided. A webhook redelivery, or
  -- the redirect arriving after the webhook already settled, lands here and
  -- stops. Note this returns the SAME answer as the first call rather than an
  -- error -- a caller retrying after a lost response must be able to tell
  -- "already done" from "failed".
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

  -- Currency before amount: 5000 ZAR against a 5000 NGN charge would pass a
  -- naive amount check and be worth roughly fifteen times too much.
  if upper(coalesce(p_currency, '')) <> upper(p.currency) then
    update public.dues_payments set raw_payload = p_raw where id = p.id;
    return 'currency_mismatch';
  end if;

  -- Greater-or-equal, following Flutterwave's prose rather than their code
  -- sample: "Verify if the amount paid is greater or equal to the amount you
  -- expect." Their sample uses strict equality, which rejects a legitimate
  -- overpayment and is brittle against rounding.
  --
  -- Compared against what we stored when the reference was claimed, NOT against
  -- the estate's current rate -- an admin editing the amount mid-checkout must
  -- not change what counts as full payment for a charge already in flight.
  if p_amount_minor < p.amount_minor then
    update public.dues_payments set raw_payload = p_raw where id = p.id;
    return 'amount_mismatch';
  end if;

  -- THE CLAIM. Conditional on the row not already being settled, so two callers
  -- racing produce exactly one winner: the loser updates zero rows and falls
  -- through to 'already_settled'.
  update public.dues_payments
     set status = 'successful', provider_tx_id = p_provider_tx_id,
         raw_payload = p_raw, settled_at = now()
   where id = p.id and status <> 'successful';
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return 'already_settled';
  end if;

  -- Conditional too. The charge may already be paid by a different attempt --
  -- somebody opened checkout twice, or a landlord and a tenant both paid. The
  -- money is real either way and the payment row stands; the charge simply does
  -- not get paid twice.
  update public.dues_charges
     set status = 'paid', paid_at = now()
   where id = p.charge_id and status = 'open';
  get diagnostics v_rows = row_count;

  return case when v_rows = 1 then 'settled' else 'settled_charge_already_paid' end;
end;
$$;

revoke execute on function public.settle_dues_payment(text, text, bigint, text, text, jsonb)
  from public, anon, authenticated;

-- ─── Reconciliation ──────────────────────────────────────────────────────────
--
-- Flutterwave's own advice, because webhooks are not guaranteed: "Have a backup
-- strategy in place in case your webhook endpoint fails... we recommend setting
-- up a background job that polls for the status of any pending transactions at
-- regular intervals."
--
-- This function does NOT decide anything. It only lists what the sweeper should
-- go and ask Flutterwave about -- a payment is never marked successful or
-- failed without a verify call, and never expired locally on a timer, because
-- "still initiated" and "paid but we never heard" look identical from here.

create function public.dues_payments_awaiting_verification(p_older_than interval default interval '10 minutes')
returns table (tx_ref text, provider_tx_id text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.tx_ref, p.provider_tx_id, p.created_at
    from public.dues_payments p
   where p.status = 'initiated'
     and p.created_at < now() - p_older_than
     -- A hosted checkout session lasts at most 24 hours, so anything older
     -- than a couple of days will never complete. Still verified rather than
     -- assumed, but not chased forever.
     and p.created_at > now() - interval '3 days'
   order by p.created_at
   limit 200;
$$;

revoke execute on function public.dues_payments_awaiting_verification(interval)
  from public, anon, authenticated;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
--
-- Policies alone do nothing without a matching GRANT: Postgres checks table
-- privileges before policies, so a SELECT policy without one fails with 42501
-- while the policy list looks correct.

alter table public.dues_charges  enable row level security;
alter table public.dues_payments enable row level security;

grant select on public.dues_charges to authenticated;

-- COLUMN-LEVEL, and raw_payload is deliberately absent.
--
-- Flutterwave's verify response carries `card.token` -- a live payment
-- credential that can charge that customer again without further consent --
-- alongside card BIN/last4 and the payer's contact details. A table-level grant
-- would hand all of it to any signed-in resident who can see the row, which for
-- a house charge is every tenant in the building.
--
-- Column-level ONLY, never table-level as well: a table grant swallows a
-- column-level restriction and silently re-opens everything. That trap is
-- already documented in 20260815180000_profiles_column_grants.sql, where it was
-- a real bug.
--
-- The consequence to know about: a role restricted this way cannot use
-- `select *` -- PostgREST returns 42501. Callers must name columns, which the
-- API layer does.
grant select (
  id, charge_id, tx_ref, provider, amount_minor, currency, status,
  initiated_by_membership_id, created_at, settled_at
) on public.dues_payments to authenticated;

-- A resident sees charges that cover them; an estate admin sees their estate's.
-- IN (SELECT ...) rather than a correlated EXISTS -- an uncorrelated sub-select
-- becomes an InitPlan evaluated once, where a correlated EXISTS stays a per-row
-- SubPlan however it is written.
create policy "dues: read charges that cover me" on public.dues_charges
  for select to authenticated
  using (
    public.current_membership(estate_id, 'admin') is not null
    or public.is_platform_admin()
    or membership_id in (
      select m.id from public.memberships m
       where m.user_id = (select auth.uid()) and m.is_active)
    or house_id in (
      select m.house_id from public.memberships m
       where m.user_id = (select auth.uid()) and m.is_active and m.house_id is not null)
  );

create policy "dues: read payments for a charge I can see" on public.dues_payments
  for select to authenticated
  using (charge_id in (select c.id from public.dues_charges c));

-- Also withheld: provider_tx_id (support-desk detail, no resident need) and
-- payer_email (in a per-house estate that is a neighbour's or a landlord's
-- personal email, which no tenant has any business reading off a payment row).
--
-- No INSERT/UPDATE/DELETE policy on either table, deliberately. Every write
-- goes through the definer functions above, exactly as for access_codes and
-- verification_events -- the missing policy is what makes that the only path,
-- and it is what stops a client marking its own charge paid.
