-- South Africa again: rand dues paid into South African bank accounts.
--
-- 20261030160000 narrowed dues to naira and payouts to Nigerian accounts while
-- no estate used either. A South African estate is now onboarding, so both
-- come back exactly as they were before that migration:
--
--   dues     NGN or ZAR: estates_dues_config_ck, dues_charges' currency check
--            and set_dues_config, which also refuses a currency the payout
--            account cannot receive (rand into NG, naira into ZA).
--   payouts  NG or ZA: estates_settlement_country_ck and set_estate_settlement.
--
-- A South African account has no name lookup on the payment rail, so its
-- holder's name is the one the admin typed and settlement_account_verified is
-- false there: unverified, not wrong. estate-settlement and the dashboard say so.
--
-- The PSIRA grade stays gone: a licence is one neutral number with the
-- estate's regulator (the NSCDC in Nigeria, PSIRA in South Africa).
--
-- Both functions are the live definitions with only those rules widened;
-- CREATE OR REPLACE keeps their grants and comments.

alter table public.estates drop constraint estates_dues_config_ck;
alter table public.estates add constraint estates_dues_config_ck check (
  dues_billing_mode = 'none'
  or (dues_amount_minor is not null and dues_amount_minor > 0 and dues_currency in ('NGN', 'ZAR'))
);

alter table public.dues_charges drop constraint dues_charges_currency_check;
alter table public.dues_charges add constraint dues_charges_currency_check check (currency in ('NGN', 'ZAR'));

alter table public.estates drop constraint estates_settlement_country_ck;
alter table public.estates add constraint estates_settlement_country_ck
  check (settlement_country is null or settlement_country in ('NG', 'ZA'));

create or replace function public.set_dues_config(p_estate_id uuid, p_billing_mode dues_billing_mode, p_amount_minor bigint DEFAULT NULL::bigint, p_currency text DEFAULT NULL::text, p_grace_days integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    -- Naira dues settle into a Nigerian account and rand dues into a South
    -- African one: an NG account cannot receive rand, nor a ZA one naira.
    -- Caught here rather than at the gateway, where it would surface as a
    -- failed payment for a resident who did nothing wrong.
    if (p_currency = 'NGN' and v_scountry is distinct from 'NG')
       or (p_currency = 'ZAR' and v_scountry is distinct from 'ZA') then
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
$function$;

create or replace function public.set_estate_settlement(p_estate_id uuid, p_country text, p_bank_code text, p_bank_name text, p_account_number text, p_account_name text, p_account_verified boolean, p_subaccount_ref text, p_subaccount_id text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e      public.estates%rowtype;
  v_mem  uuid;
begin
  select * into e from public.estates where id = p_estate_id;
  if e.id is null then
    raise exception 'no_such_estate' using errcode = '42704';
  end if;

  if p_country is null or p_country not in ('NG', 'ZA') then
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
$function$;

comment on column public.estates.settlement_account_verified is
  'True only where the bank confirmed the account holder name (NG accounts). '
  'A ZA account has no name lookup, so false there means unverified, not wrong.';

comment on column public.profiles.licence_number is
  'The guard''s licence number with the body that regulates private guards in the estate''s '
  'country: the NSCDC in Nigeria, PSIRA in South Africa. Person-scoped and portable between '
  'employers. Opaque string: no regulator publishes a format to validate against.';
