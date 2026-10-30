-- Nigeria only: dues in naira, payouts to Nigerian accounts, no PSIRA grade.
--
-- The product is built for Nigerian estates. It also carried South African
-- support -- ZAR dues, ZA payout accounts with their unverifiable account
-- names, and PSIRA's A-E officer grade -- that no estate, payment or agency
-- has ever used (checked live before writing this: no ZA payout account, no
-- ZAR estate, charge or payment, no graded licence). It goes, so the rules
-- the database enforces are the ones the product actually has.
--
--   dues            NGN only: estates_dues_config_ck, dues_charges' currency
--                   check and set_dues_config.
--   payouts         NG only: estates_settlement_country_ck and
--                   set_estate_settlement. The country column and parameter
--                   stay, so the edge function's call is unchanged.
--   officer grade   profiles.licence_grade is dropped, and with it the grade in
--                   the guard profile, both detail views, the agency roster,
--                   the monthly return and record_guard_licence's p_grade.
--
-- Functions are the live definitions with only those parts removed. Where a
-- result or signature changes they are dropped and created, and their grants
-- restated. agencies.registration_body stays free text (an NSCDC licence).

-- Refuse rather than orphan: if anything had started using the South African
-- paths since the check above, the constraints below would fail on it anyway,
-- but this says why.
do $$
begin
  if exists (select 1 from public.estates where settlement_country = 'ZA' or dues_currency = 'ZAR')
     or exists (select 1 from public.dues_charges where currency = 'ZAR')
     or exists (select 1 from public.dues_payments where currency = 'ZAR')
     or exists (select 1 from public.profiles where licence_grade is not null) then
    raise exception 'south_african_data_present: migrate it before removing ZA/ZAR/grade support';
  end if;
end $$;

-- ─── Dues: naira only ────────────────────────────────────────────────────────

alter table public.estates drop constraint estates_dues_config_ck;
alter table public.estates add constraint estates_dues_config_ck check (
  dues_billing_mode = 'none'
  or (dues_amount_minor is not null and dues_amount_minor > 0 and dues_currency = 'NGN')
);

alter table public.dues_charges drop constraint dues_charges_currency_check;
alter table public.dues_charges add constraint dues_charges_currency_check check (currency = 'NGN');

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
    if p_currency is distinct from 'NGN' then
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

    -- Naira dues settle into a Nigerian account. estates_settlement_country_ck
    -- already allows nothing else; checked here too so a mismatch is refused
    -- before billing starts rather than surfacing as a failed payment for a
    -- resident who did nothing wrong.
    if v_scountry is distinct from 'NG' then
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

-- ─── Payouts: Nigerian accounts only ─────────────────────────────────────────

alter table public.estates drop constraint estates_settlement_country_ck;
alter table public.estates add constraint estates_settlement_country_ck
  check (settlement_country is null or settlement_country = 'NG');

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

  if p_country is distinct from 'NG' then
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
  'True where the bank confirmed the account holder name. Every payout account is Nigerian and '
  'is checked against the bank before it is saved.';

-- ─── Officer grade: gone ─────────────────────────────────────────────────────

-- Dropped before the column so nothing is left naming it, and in dependency
-- order: estate_guard_profile returns guard_profile_row's columns.
drop function public.estate_guard_profile(uuid, uuid);
drop function private.guard_profile_row(uuid);
drop function public.agency_roster(uuid);
drop function public.agency_monthly_return(uuid, date);
drop function public.record_guard_licence(uuid, text, text, timestamptz);

alter table public.profiles drop column licence_grade;  -- takes profiles_licence_grade_ck with it

create function private.guard_profile_row(p_membership_id uuid)
 RETURNS TABLE(membership_id uuid, user_id uuid, full_name text, phone text, email text, is_active boolean, joined_at timestamp with time zone, last_sign_in_at timestamp with time zone, agency_name text, licence_number text, licence_expires_at timestamp with time zone, licence_verified_at timestamp with time zone, on_duty_since timestamp with time zone, shifts_30d integer, hours_on_duty_30d numeric, last_shift_at timestamp with time zone, verifications_30d integer, admitted_30d integer, rejected_30d integer, offline_30d integer, flagged_30d integer, last_verification_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with w as (select now() - interval '30 days' as since)
  select
    m.id,
    m.user_id,
    coalesce(nullif(btrim(p.full_name), ''), 'Unnamed'),
    p.phone,
    u.email::text,
    m.is_active,
    m.created_at,
    u.last_sign_in_at,
    a.name,
    p.licence_number,
    p.licence_expires_at,
    p.licence_verified_at,
    (select s.started_at from public.guard_shifts s
      where s.membership_id = m.id and s.ended_at is null
      order by s.started_at desc limit 1),
    (select count(*) from public.guard_shifts s
      where s.membership_id = m.id and coalesce(s.ended_at, now()) > w.since)::integer,
    -- Clipped to the window; server times only. See 20261001120000.
    round((select coalesce(sum(extract(epoch from
              least(coalesce(s.ended_at, now()), now()) - greatest(s.started_at, w.since))), 0)
             from public.guard_shifts s
            where s.membership_id = m.id
              and coalesce(s.ended_at, now()) > w.since) / 3600.0, 1),
    (select max(s.started_at) from public.guard_shifts s where s.membership_id = m.id),
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > w.since)::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > w.since
        and v.outcome = 'admitted')::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > w.since
        and v.outcome in ('rejected', 'collision'))::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > w.since
        and v.source = 'offline_replay')::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > w.since
        and v.admitted_without_match)::integer,
    (select max(v.synced_at) from public.verification_events v
      where v.verified_by_membership_id = m.id)
  from w
  cross join public.memberships m
  join auth.users u           on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  left join public.agencies a on a.id = m.placed_by_agency_id
  where m.id = p_membership_id
    and m.role = 'guard';
$function$;

revoke execute on function private.guard_profile_row(uuid) from public, anon, authenticated;

create function public.estate_guard_profile(p_estate_id uuid, p_guard_membership_id uuid)
 RETURNS TABLE(membership_id uuid, user_id uuid, full_name text, phone text, email text, is_active boolean, joined_at timestamp with time zone, last_sign_in_at timestamp with time zone, agency_name text, licence_number text, licence_expires_at timestamp with time zone, licence_verified_at timestamp with time zone, on_duty_since timestamp with time zone, shifts_30d integer, hours_on_duty_30d numeric, last_shift_at timestamp with time zone, verifications_30d integer, admitted_30d integer, rejected_30d integer, offline_30d integer, flagged_30d integer, last_verification_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_estate_id is null or public.current_membership(p_estate_id, 'admin') is null then
    raise exception 'not_an_estate_admin' using errcode = '42501';
  end if;
  return query
  select g.* from private.guard_profile_row(p_guard_membership_id) g
   where exists (select 1 from public.memberships m
                  where m.id = p_guard_membership_id and m.estate_id = p_estate_id);
end;
$function$;

revoke execute on function public.estate_guard_profile(uuid, uuid) from public, anon;
grant  execute on function public.estate_guard_profile(uuid, uuid) to authenticated;

create function public.agency_roster(p_agency_id uuid)
 RETURNS TABLE(agency_membership_id uuid, full_name text, role agency_role, is_active boolean, registration_number text, registration_expires_at timestamp with time zone, registration_checked_at timestamp with time zone, estates_posted bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_agency_admin(p_agency_id) and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;

  return query
  select am.id,
         p.full_name,
         am.role,
         am.is_active,
         p.licence_number,
         p.licence_expires_at,
         p.licence_verified_at,
         (select count(*) from public.memberships m
           where m.user_id = am.user_id
             and m.role = 'guard'
             and m.is_active
             and m.placed_by_agency_id = p_agency_id)
    from public.agency_memberships am
    join public.profiles p on p.id = am.user_id
   where am.agency_id = p_agency_id
   order by am.is_active desc, p.full_name;
end;
$function$;

revoke execute on function public.agency_roster(uuid) from public, anon;
grant  execute on function public.agency_roster(uuid) to authenticated;

create function public.agency_monthly_return(p_agency_id uuid, p_month date)
 RETURNS TABLE(officer_name text, registration_number text, contact_phone text, registration_expires_at timestamp with time zone, registration_checked_at timestamp with time zone, estate_name text, estate_address text, first_shift_at timestamp with time zone, last_shift_at timestamp with time zone, shifts bigint, hours numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_from timestamptz := date_trunc('month', p_month::timestamptz);
  v_to   timestamptz := date_trunc('month', p_month::timestamptz) + interval '1 month';
begin
  -- Identity from auth.uid(). p_agency_id is client-supplied, so membership of
  -- that agency is verified before anything is read -- the same discipline
  -- every estate-scoped RPC applies to p_estate_id, and for the same reason.
  -- Without it, any signed-in user could name another agency's id and read its
  -- entire workforce: the confused-deputy problem, with us as the deputy.
  if not exists (
    select 1 from public.agency_memberships am
     where am.agency_id = p_agency_id
       and am.user_id   = (select auth.uid())
       and am.role      = 'admin'
       and am.is_active
  ) and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;

  return query
  select
    p.full_name,
    p.licence_number,
    p.phone,
    p.licence_expires_at,
    p.licence_verified_at,
    e.name,
    e.address,
    min(s.started_at),
    max(coalesce(s.ended_at, s.started_at)),
    count(*),
    -- Hours to two places: the return asks for duration, and rounding a
    -- 12-hour shift to whole hours across a month's worth of posts is how a
    -- return becomes "materially misleading".
    round(sum(
      extract(epoch from (coalesce(s.ended_at, s.started_at) - s.started_at)) / 3600.0
    )::numeric, 2)
  from public.guard_shifts s
  join public.memberships m on m.id = s.membership_id
  join public.profiles    p on p.id = m.user_id
  join public.estates     e on e.id = s.estate_id
  -- The STAMP, not the guard's current employer. A return for last November
  -- must describe who was responsible in November; reading it off
  -- placed_by_agency_id would silently re-file those shifts under whichever
  -- agency happens to employ the officer today.
  where s.agency_id = p_agency_id
    and s.started_at >= v_from
    and s.started_at <  v_to
  group by p.full_name, p.licence_number, p.phone,
           p.licence_expires_at, p.licence_verified_at, e.name, e.address
  order by p.full_name, e.name;
end;
$function$;

revoke execute on function public.agency_monthly_return(uuid, date) from public, anon;
grant  execute on function public.agency_monthly_return(uuid, date) to authenticated;

create function public.record_guard_licence(p_user_id uuid, p_licence_number text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (
        select 1 from public.agency_memberships am
         where am.user_id = p_user_id and am.is_active
           and public.is_agency_admin(am.agency_id))
     and not exists (
        select 1 from public.memberships m
         where m.user_id = p_user_id and m.role = 'guard' and m.is_active
           and public.current_membership(m.estate_id, 'admin') is not null)
     and not public.is_platform_admin() then
    raise exception 'not_this_officer_s_employer' using errcode = '42501';
  end if;

  update public.profiles
     set licence_number = nullif(btrim(coalesce(p_licence_number, '')), ''),
         licence_expires_at          = p_expires_at,
         -- Set HERE and nowhere else, and only as a side effect of a person
         -- doing the check. It records that a human looked, on this date --
         -- never that a system verified, because there is no API to verify
         -- against and claiming otherwise would be the lie the field exists
         -- to prevent.
         licence_verified_at         = now()
   where id = p_user_id;

  if not found then
    raise exception 'no_such_profile' using errcode = '42704';
  end if;
end;
$function$;

revoke execute on function public.record_guard_licence(uuid, text, timestamptz) from public, anon;
grant  execute on function public.record_guard_licence(uuid, text, timestamptz) to authenticated;

create or replace function public.operator_person_detail(p_target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_guards uuid[];
  v_out    jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  select array_agg(m.id) into v_guards
    from public.memberships m where m.user_id = p_target_user_id and m.role = 'guard';

  select jsonb_build_object(
    'person', jsonb_build_object(
      'user_id', u.id,
      'full_name', coalesce(nullif(btrim(p.full_name), ''), 'Unnamed'),
      'phone', p.phone, 'email', u.email,
      'email_confirmed', u.email_confirmed_at is not null,
      'last_sign_in_at', u.last_sign_in_at,
      'is_platform_admin', exists (select 1 from public.platform_admins pa where pa.user_id = u.id),
      'licence_number', p.licence_number,
      'licence_expires_at', p.licence_expires_at, 'licence_verified_at', p.licence_verified_at),
    'memberships', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'membership_id', m.id, 'estate_id', m.estate_id, 'estate_name', e.name,
               'role', m.role, 'is_active', m.is_active, 'joined_at', m.created_at,
               'house_number', h.house_number, 'agency_name', a.name)
             order by m.is_active desc, e.name), '[]'::jsonb)
        from public.memberships m
        join public.estates e on e.id = m.estate_id
        left join public.houses h on h.id = m.house_id
        left join public.agencies a on a.id = m.placed_by_agency_id
       where m.user_id = u.id),
    'agencies', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'agency_name', a.name, 'role', am.role, 'is_active', am.is_active,
               'joined_at', am.created_at) order by a.name), '[]'::jsonb)
        from public.agency_memberships am join public.agencies a on a.id = am.agency_id
       where am.user_id = u.id),
    -- Every guard posting, each with the same stats the estate admin sees.
    'guard', (
      select coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object('estate_name', e.name)), '[]'::jsonb)
        from unnest(coalesce(v_guards, '{}')) gid
        cross join lateral private.guard_profile_row(gid) g
        join public.memberships m on m.id = gid
        join public.estates e on e.id = m.estate_id),
    'shifts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'shift_id', s.id, 'estate_name', e.name, 'started_at', s.started_at,
               'ended_at', s.ended_at, 'ended_by_handover', s.ended_by_handover)
             order by s.started_at desc), '[]'::jsonb)
        from (select * from public.guard_shifts s
               where s.membership_id = any (coalesce(v_guards, '{}'))
               order by s.started_at desc limit 50) s
        join public.estates e on e.id = s.estate_id),
    'events', case when v_guards is null then '[]'::jsonb
                   else private.gate_event_rows(null, v_guards, 30) end
  )
  into v_out
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_target_user_id;

  return v_out;
end;
$function$;

create or replace function public.agency_officer_detail(p_agency_membership_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  am      public.agency_memberships%rowtype;
  v_since constant timestamptz := now() - interval '30 days';
  v_out   jsonb;
begin
  select * into am from public.agency_memberships where id = p_agency_membership_id;
  if am.id is null then
    -- Same refusal as "not yours": an unknown id must not be distinguishable.
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;
  if not public.is_agency_admin(am.agency_id) and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'officer', jsonb_build_object(
      'agency_membership_id', am.id,
      'full_name', coalesce(nullif(btrim(p.full_name), ''), 'Unnamed'),
      'phone', p.phone, 'email', u.email, 'role', am.role, 'is_active', am.is_active,
      'joined_at', am.created_at, 'last_sign_in_at', u.last_sign_in_at,
      'licence_number', p.licence_number,
      'licence_expires_at', p.licence_expires_at, 'licence_verified_at', p.licence_verified_at),
    'postings', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'estate_id', e.id, 'estate_name', e.name, 'is_active', m.is_active,
               'posted_at', m.created_at,
               'on_duty_since', (select s.started_at from public.guard_shifts s
                                  where s.membership_id = m.id and s.ended_at is null
                                    and s.agency_id = am.agency_id limit 1))
             order by m.is_active desc, e.name), '[]'::jsonb)
        from public.memberships m join public.estates e on e.id = m.estate_id
       where m.user_id = am.user_id and m.role = 'guard'
         and m.placed_by_agency_id = am.agency_id),
    'stats_30d', jsonb_build_object(
      'shifts', (select count(*) from public.guard_shifts s
                   join public.memberships m on m.id = s.membership_id
                  where m.user_id = am.user_id and s.agency_id = am.agency_id
                    and s.started_at > v_since),
      'hours', (select round(coalesce(sum(extract(epoch from
                         coalesce(s.ended_at, now()) - s.started_at)), 0) / 3600.0, 1)
                  from public.guard_shifts s
                  join public.memberships m on m.id = s.membership_id
                 where m.user_id = am.user_id and s.agency_id = am.agency_id
                   and s.started_at > v_since),
      'admitted', (select count(*) from public.verification_events v
                     join public.memberships m on m.id = v.verified_by_membership_id
                    where m.user_id = am.user_id and v.agency_id = am.agency_id
                      and v.synced_at > v_since and v.outcome = 'admitted'
                      and not v.admitted_without_match),
      'refused', (select count(*) from public.verification_events v
                    join public.memberships m on m.id = v.verified_by_membership_id
                   where m.user_id = am.user_id and v.agency_id = am.agency_id
                     and v.synced_at > v_since and v.outcome in ('rejected', 'collision')),
      'flagged', (select count(*) from public.verification_events v
                    join public.memberships m on m.id = v.verified_by_membership_id
                   where m.user_id = am.user_id and v.agency_id = am.agency_id
                     and v.synced_at > v_since and v.admitted_without_match)),
    -- Attendance: when their employee held which gate. About the officer, not
    -- about anyone who came through it.
    'shifts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'estate_name', e.name, 'started_at', s.started_at, 'ended_at', s.ended_at,
               'ended_by_handover', s.ended_by_handover) order by s.started_at desc), '[]'::jsonb)
        from (select s.* from public.guard_shifts s
                join public.memberships m on m.id = s.membership_id
               where m.user_id = am.user_id and s.agency_id = am.agency_id
               order by s.started_at desc limit 50) s
        join public.estates e on e.id = s.estate_id)
  )
  into v_out
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = am.user_id;

  return v_out;
end;
$function$;

-- ─── Descriptions ────────────────────────────────────────────────────────────

comment on column public.profiles.licence_number is
  'The guard''s licence number with the NSCDC, which regulates private guard companies in '
  'Nigeria. Person-scoped and portable between employers. Opaque string: the NSCDC publishes '
  'no format to validate against.';

comment on function public.agency_monthly_return(uuid, date) is
  'Monthly officer return assembled from stamped shifts: each officer''s licence number, sites '
  'and hours.';

comment on function public.record_guard_licence(uuid, text, timestamptz) is
  'Records a guard''s licence and stamps licence_verified_at as the moment a person checked it. '
  'Only the employer may: an admin of an agency the guard works for, an admin of an estate they '
  'guard, or the platform owner -- never the guard about themselves.';
