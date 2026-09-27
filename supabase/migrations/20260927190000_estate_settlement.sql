-- Estate Access Platform — dues settle to the estate's own bank account
--
-- Until this migration, a dues payment landed in the platform's Flutterwave
-- balance and would have been paid onward to the estate. That design is not a
-- latency problem to be optimised; it is unlawful in both markets we operate
-- in, and the fix is structural: the money must never be ours.
--
-- ─── Why ─────────────────────────────────────────────────────────────────────
--
-- NIGERIA. Only a Mobile Money Operator (₦2bn capital) may hold customer
-- funds. The activity we perform -- "merchant aggregation and collection
-- services" -- is a PSSP activity (₦100m), and no single CBN licence
-- authorises aggregating AND holding. The Regulatory Framework for Non-Bank
-- Acquiring goes further: even a fully licensed acquirer is "prohibited from
-- having direct access to or from holding Merchants' Funds for any other
-- reason whatsoever". The Guidelines on Operations of Electronic Payment
-- Channels §4.6.1 require web settlement "to the merchant account on a T+1
-- basis". Holding Flutterwave's licence does not help us: Flutterwave holds
-- Switching and PSSP, neither of which may hold customer funds, and a licensee
-- cannot confer a permission it does not itself have. The CBN fined Paystack
-- ₦250m in April 2025 over exactly that argument.
--
-- SOUTH AFRICA. Accepting money from multiple payers on behalf of a
-- beneficiary makes us a Beneficiary Service Provider -- a TPPP under SARB
-- Directive 1 of 2007 -- requiring registration through a sponsoring bank.
-- Decisively, CSOS Consolidated Practice Directive 1 of 2025 §13.3 and PMR
-- 21(4) permit exactly two destinations for a body corporate's money: an
-- account in the name of the body corporate, or a statutory trust account. A
-- platform's merchant balance is neither. Body Corporate of Stamford Hall v
-- Molapo [2022] ZAGPJHC 498 upheld the appointment of an administrator on
-- precisely these facts -- levies paid into an account not in the scheme's
-- name.
--
-- CONTRACTUALLY, before any regulator. Paystack's Merchant Service Agreement
-- cl 7 makes acting as a payment aggregator "a material breach... Paystack may
-- immediately terminate this Agreement and your Paystack Account". Flutterwave
-- requires pre-approval for payment facilitators and marketplaces. The nearest
-- risk is not a fine; it is our PSP freezing a balance with estates' money in
-- it that we cannot segregate.
--
-- ─── The rule this file encodes ──────────────────────────────────────────────
--
-- Nothing settles to us except our own commission. Every naira and rand of
-- dues settles directly into the estate's own bank account, in the estate's own
-- name, by Flutterwave subaccount split. If estate money ever rests in our
-- balance we are back inside the prohibition -- so treat any such path as a
-- bug, not an edge case. Known remaining exposures, deliberately listed rather
-- than hidden: refunds and chargebacks debit the platform balance, and are why
-- we do not offer self-service refunds here.
--
-- ─── Verified against the live Flutterwave sandbox, 27 Sep 2026 ─────────────
--
-- Four behaviours that are not obvious from the documentation and that the
-- code below depends on:
--
--  1. A SUBACCOUNT HAS TWO IDS AND THEY ARE NOT INTERCHANGEABLE. Creation
--     returns `id` (numeric, e.g. 26704) and `subaccount_id` (e.g. RS_F317...).
--     The charge payload wants the RS_ string. GET and DELETE want the NUMERIC
--     one -- GET /subaccounts/RS_... returns "Subaccount not found" for a
--     subaccount that demonstrably exists. Storing only one id means either
--     being unable to charge or being unable to ever re-verify. So both.
--
--  2. AN INVALID SUBACCOUNT ID ON A CHARGE IS SILENTLY ACCEPTED. Posting a
--     charge with id "RS_TOTALLYNOTREAL" returns 200 success and a payable
--     link. The split simply does not happen and the whole payment lands in
--     the platform balance -- the exact outcome this file exists to prevent,
--     arriving with no error at all. The subaccount must therefore be proven
--     to exist BEFORE it is stored, because the payment path will never tell
--     us. That is what settlement_subaccount_id (the numeric one) is for.
--
--  3. NIGERIA CAN VERIFY AN ACCOUNT NAME; SOUTH AFRICA CANNOT. POST
--     /accounts/resolve returns the registered holder's name for an NG account
--     and 400 "invalid account" for a bad number. The same call for a ZA
--     account returns 400 "invalid account" even for a well-formed one -- there
--     is no name lookup. A ZA subaccount's full_name is just the business name
--     we typed, unverified. settlement_account_verified records which of the
--     two we have, because "the bank confirmed this name" and "the admin typed
--     this name" must not look the same on screen.
--
--  4. transaction_charge_type = 'percentage' charges the MAIN account's
--     commission, not the subaccount's share: "to collect a 9% commission,
--     transaction_charge_type will be 'percentage' and transaction_charge will
--     be 0.09", and the subaccount receives the remainder. A FLAT split is
--     avoided deliberately -- in Nigeria the ₦50 stamp duty on qualifying
--     transfers can exceed the arithmetic room in a flat split and void it,
--     sending the entire payment to the platform.

-- ─── Where an estate's money goes ────────────────────────────────────────────

alter table public.estates add column settlement_country          text;
alter table public.estates add column settlement_bank_code        text;
alter table public.estates add column settlement_bank_name        text;
alter table public.estates add column settlement_account_number   text;
alter table public.estates add column settlement_account_name     text;

-- True only when the BANK told us the name (Nigeria). False means an admin
-- typed it and nobody checked -- see note 3 above.
alter table public.estates add column settlement_account_verified boolean not null default false;

-- The RS_ string. This is what goes in the charge payload.
alter table public.estates add column settlement_subaccount_ref   text;
-- The numeric id. This is the ONLY one that can be used to re-verify or remove
-- the subaccount, and note 2 is why being able to re-verify matters.
alter table public.estates add column settlement_subaccount_id    text;
alter table public.estates add column settlement_verified_at      timestamptz;

-- Our commission, as a decimal fraction. 0.05 is five percent.
--
-- Zero by default, and deliberately so: a platform fee is a commercial
-- decision nobody has made yet, and defaulting to a non-zero one would skim
-- estate money by accident. Set per estate by the platform owner, never by the
-- estate's own admin -- an estate cannot vote itself a discount.
alter table public.estates
  add column platform_fee_percent numeric(6,4) not null default 0;

alter table public.estates
  add constraint estates_platform_fee_ck
  check (platform_fee_percent >= 0 and platform_fee_percent <= 0.2);

alter table public.estates
  add constraint estates_settlement_country_ck
  check (settlement_country is null or settlement_country in ('NG', 'ZA'));

-- All of it or none of it. A half-written settlement record is the state in
-- which we know where to send money but cannot prove whose account it is.
alter table public.estates
  add constraint estates_settlement_complete_ck check (
    settlement_subaccount_ref is null
    or (settlement_subaccount_id  is not null
        and settlement_country    is not null
        and settlement_bank_code  is not null
        and settlement_account_number is not null
        and settlement_account_name   is not null
        and settlement_verified_at    is not null)
  );

-- ★ THE STRUCTURAL GUARANTEE ★
--
-- An estate cannot bill without a destination for the money. Not a check in
-- application code that a later code path could forget -- a table constraint,
-- so that the state "charging residents with nowhere to settle" is not
-- representable. Without it the failure mode is silent: charges raise, payments
-- succeed, and every naira accumulates in the platform balance.
alter table public.estates
  add constraint estates_dues_need_settlement_ck check (
    dues_billing_mode = 'none' or settlement_subaccount_ref is not null
  );

comment on column public.estates.settlement_subaccount_ref is
  'Flutterwave subaccount (RS_...) that dues settle into. The charge payload '
  'uses this; GET/DELETE need settlement_subaccount_id instead.';
comment on column public.estates.settlement_account_verified is
  'True only where the bank confirmed the account holder name (Nigeria). '
  'South Africa has no name lookup, so false there means unverified, not wrong.';

-- ─── Who changed the payout destination ──────────────────────────────────────
--
-- The single most attractive row in this database to an attacker, and the one
-- an estate will ask about first if money goes astray. An append-only record of
-- every change, because "when did this become someone else's account, and who
-- did it" is not answerable from the estates row alone -- that only ever holds
-- the current value.

create table public.estate_settlement_changes (
  id         uuid primary key default gen_random_uuid(),
  estate_id  uuid not null references public.estates (id) on delete cascade,
  changed_at timestamptz not null default now(),
  -- Null when a platform operator did it rather than an estate admin.
  changed_by_membership_id uuid references public.memberships (id),
  changed_by_user_id       uuid references auth.users (id),

  -- Masked. The full number lives on the estate row because the subaccount may
  -- need rebuilding; there is no reason for the audit trail to hold a second
  -- copy of it.
  old_account_mask text,
  new_account_mask text,
  old_bank_code    text,
  new_bank_code    text,
  old_subaccount_ref text,
  new_subaccount_ref text,
  action text not null,

  constraint estate_settlement_changes_action_ck
    check (action in ('set', 'replaced', 'cleared'))
);

create index estate_settlement_changes_estate_idx
  on public.estate_settlement_changes (estate_id, changed_at desc);

alter table public.estate_settlement_changes enable row level security;
grant select on public.estate_settlement_changes to authenticated;

create policy "settlement: admins read their estate's changes"
  on public.estate_settlement_changes
  for select to authenticated
  using (
    public.current_membership(estate_id, 'admin') is not null
    or public.is_platform_admin()
  );

-- No write policy, deliberately, matching access_codes and verification_events:
-- the only way a row appears here is the SECURITY DEFINER path below, so the
-- audit trail cannot be edited by the person it is auditing.

-- ─── Masking ─────────────────────────────────────────────────────────────────

create function public.mask_account_number(p_number text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_number is null then null
    when length(p_number) <= 4 then repeat('•', length(p_number))
    else repeat('•', length(p_number) - 4) || right(p_number, 4)
  end;
$$;

revoke execute on function public.mask_account_number(text) from public, anon;
grant  execute on function public.mask_account_number(text) to authenticated;

-- ─── Recording a settlement destination ──────────────────────────────────────
--
-- Not callable by an estate admin, and that is the point.
--
-- The admin supplies bank details; the Edge Function resolves them against
-- Flutterwave, creates the subaccount, proves it exists by fetching it back,
-- and only then calls this. If an admin could call it directly they could store
-- any subaccount reference at all -- including one belonging to another estate
-- -- and every subsequent payment would settle there. Routing it through the
-- server is what makes the stored reference provably correspond to the stored
-- account number.
--
-- p_actor_user_id is passed by the Edge Function, which is the one exception to
-- deriving identity from auth.uid() that this codebase allows: there is no
-- auth.uid() under the service role, and the value is taken from a JWT the
-- function has already verified, never from the request body.

create function public.set_estate_settlement(
  p_estate_id        uuid,
  p_country          text,
  p_bank_code        text,
  p_bank_name        text,
  p_account_number   text,
  p_account_name     text,
  p_account_verified boolean,
  p_subaccount_ref   text,
  p_subaccount_id    text,
  p_actor_user_id    uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e      public.estates%rowtype;
  v_mem  uuid;
begin
  select * into e from public.estates where id = p_estate_id;
  if e.id is null then
    raise exception 'no_such_estate' using errcode = '42704';
  end if;

  if p_country not in ('NG', 'ZA') then
    raise exception 'unsupported_country' using errcode = '22023';
  end if;
  if coalesce(btrim(p_subaccount_ref), '') = '' or coalesce(btrim(p_subaccount_id), '') = '' then
    -- Both, always. Note 1 at the top of this file: one id charges, the other
    -- verifies, and a record with only one of them is a dead end in one
    -- direction or the other.
    raise exception 'both_subaccount_ids_required' using errcode = '22023';
  end if;

  select m.id into v_mem
    from public.memberships m
   where m.user_id = p_actor_user_id and m.estate_id = p_estate_id
     and m.role = 'admin' and m.is_active;

  insert into public.estate_settlement_changes (
    estate_id, changed_by_membership_id, changed_by_user_id,
    old_account_mask, new_account_mask, old_bank_code, new_bank_code,
    old_subaccount_ref, new_subaccount_ref, action
  ) values (
    p_estate_id, v_mem, p_actor_user_id,
    public.mask_account_number(e.settlement_account_number),
    public.mask_account_number(p_account_number),
    e.settlement_bank_code, p_bank_code,
    e.settlement_subaccount_ref, p_subaccount_ref,
    case when e.settlement_subaccount_ref is null then 'set' else 'replaced' end
  );

  update public.estates
     set settlement_country          = p_country,
         settlement_bank_code        = p_bank_code,
         settlement_bank_name        = p_bank_name,
         settlement_account_number   = p_account_number,
         settlement_account_name     = p_account_name,
         settlement_account_verified = coalesce(p_account_verified, false),
         settlement_subaccount_ref   = p_subaccount_ref,
         settlement_subaccount_id    = p_subaccount_id,
         settlement_verified_at      = now()
   where id = p_estate_id;
end;
$$;

revoke execute on function public.set_estate_settlement(
  uuid, text, text, text, text, text, boolean, text, text, uuid)
  from public, anon, authenticated;

-- ─── Removing one ────────────────────────────────────────────────────────────
--
-- Callable by an estate admin: taking the destination away can only stop money
-- moving, never redirect it, so it does not carry the risk that setting one
-- does. The table constraint means this fails while dues are switched on, which
-- is the correct order -- stop billing, then remove the account.

create function public.clear_estate_settlement(p_estate_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e       public.estates%rowtype;
  v_admin uuid := public.current_membership(p_estate_id, 'admin');
begin
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  select * into e from public.estates where id = p_estate_id;
  if e.id is null then
    raise exception 'no_such_estate' using errcode = '42704';
  end if;
  if e.settlement_subaccount_ref is null then
    return;
  end if;

  if e.dues_billing_mode <> 'none' then
    raise exception 'turn_off_dues_first' using errcode = '23514';
  end if;

  insert into public.estate_settlement_changes (
    estate_id, changed_by_membership_id, changed_by_user_id,
    old_account_mask, old_bank_code, old_subaccount_ref, action
  ) values (
    p_estate_id, v_admin, auth.uid(),
    public.mask_account_number(e.settlement_account_number),
    e.settlement_bank_code, e.settlement_subaccount_ref, 'cleared'
  );

  update public.estates
     set settlement_country = null, settlement_bank_code = null,
         settlement_bank_name = null, settlement_account_number = null,
         settlement_account_name = null, settlement_account_verified = false,
         settlement_subaccount_ref = null, settlement_subaccount_id = null,
         settlement_verified_at = null
   where id = p_estate_id;
end;
$$;

revoke execute on function public.clear_estate_settlement(uuid) from public, anon;
grant  execute on function public.clear_estate_settlement(uuid) to authenticated;

-- ─── Reading it back ─────────────────────────────────────────────────────────
--
-- A function rather than widening the estates SELECT policy, because an
-- account number is not something every resident of an estate should be able
-- to read off the estates row -- and the number comes back masked even to the
-- admin who set it. They do not need it to confirm it is right; the resolved
-- name and the last four digits are what tells them that, and a full number on
-- a dashboard is a number that ends up in a screenshot.

create function public.estate_settlement(p_estate_id uuid)
returns table (
  country          text,
  bank_code        text,
  bank_name        text,
  account_mask     text,
  account_name     text,
  account_verified boolean,
  configured_at    timestamptz,
  fee_percent      numeric,
  billing_mode     public.dues_billing_mode
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.current_membership(p_estate_id, 'admin');
begin
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  return query
  select e.settlement_country, e.settlement_bank_code, e.settlement_bank_name,
         public.mask_account_number(e.settlement_account_number),
         e.settlement_account_name, e.settlement_account_verified,
         e.settlement_verified_at, e.platform_fee_percent, e.dues_billing_mode
    from public.estates e
   where e.id = p_estate_id;
end;
$$;

revoke execute on function public.estate_settlement(uuid) from public, anon;
grant  execute on function public.estate_settlement(uuid) to authenticated;

-- ─── The commission ──────────────────────────────────────────────────────────
--
-- Platform owner only. An estate administrator setting their own estate's
-- commission is an estate voting itself a discount, and the same call in the
-- other direction would let them raise it on residents.

create function public.set_platform_fee(p_estate_id uuid, p_fee_percent numeric)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform_admin_only' using errcode = '42501';
  end if;
  if p_fee_percent is null or p_fee_percent < 0 or p_fee_percent > 0.2 then
    raise exception 'fee_out_of_range' using errcode = '22023';
  end if;

  update public.estates set platform_fee_percent = p_fee_percent where id = p_estate_id;
  if not found then
    raise exception 'no_such_estate' using errcode = '42704';
  end if;
end;
$$;

revoke execute on function public.set_platform_fee(uuid, numeric) from public, anon;
grant  execute on function public.set_platform_fee(uuid, numeric) to authenticated;
