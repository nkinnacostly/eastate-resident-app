-- Guard licence columns lose the PSIRA name.
--
-- The licence fields on profiles were modelled on PSIRA's register and named
-- after it (psira_registration_number, psira_grade, ...). The product is
-- built for Nigerian estates, where private guards come under the NSCDC, so a
-- regulator's name in the schema was wrong for most of the people it describes.
-- The fields themselves are regulator-neutral: an opaque licence number, an
-- optional grade (PSIRA's A-E ladder, still enforced -- a Nigerian licence
-- simply leaves it null), an expiry, and when a human last checked it.
--
--   psira_registration_number -> licence_number
--   psira_grade               -> licence_grade
--   psira_expires_at          -> licence_expires_at
--   psira_verified_at         -> licence_verified_at
--   record_psira_registration -> record_guard_licence
--
-- Every function that reads the columns is recreated below with the bodies it
-- already had (checked byte-for-byte against the live definitions), only the
-- names changed. plpgsql and non-atomic SQL bodies are stored as text and not
-- dependency-tracked, so a bare RENAME COLUMN would have left them failing at
-- call time rather than here. Where an output column changes name the function
-- has to be dropped and created, which resets its grants -- they are restated.
--
-- apply_retention mentions PSIRA only in a comment and reads none of these
-- columns, so it is left alone. agency_roster and agency_monthly_return already
-- expose neutral names (registration_number, grade, ...) and keep them.

alter table public.profiles rename column psira_registration_number to licence_number;
alter table public.profiles rename column psira_grade               to licence_grade;
alter table public.profiles rename column psira_expires_at          to licence_expires_at;
alter table public.profiles rename column psira_verified_at         to licence_verified_at;
alter table public.profiles rename constraint profiles_psira_grade_ck to profiles_licence_grade_ck;

-- ─── Output columns renamed: drop and create ─────────────────────────────────

-- estate_guard_profile returns guard_profile_row's columns, so it goes first.
drop function public.estate_guard_profile(uuid, uuid);
drop function private.guard_profile_row(uuid);

create function private.guard_profile_row(p_membership_id uuid)
 RETURNS TABLE(membership_id uuid, user_id uuid, full_name text, phone text, email text, is_active boolean, joined_at timestamp with time zone, last_sign_in_at timestamp with time zone, agency_name text, licence_number text, licence_grade text, licence_expires_at timestamp with time zone, licence_verified_at timestamp with time zone, on_duty_since timestamp with time zone, shifts_30d integer, hours_on_duty_30d numeric, last_shift_at timestamp with time zone, verifications_30d integer, admitted_30d integer, rejected_30d integer, offline_30d integer, flagged_30d integer, last_verification_at timestamp with time zone)
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
    p.licence_grade,
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
 RETURNS TABLE(membership_id uuid, user_id uuid, full_name text, phone text, email text, is_active boolean, joined_at timestamp with time zone, last_sign_in_at timestamp with time zone, agency_name text, licence_number text, licence_grade text, licence_expires_at timestamp with time zone, licence_verified_at timestamp with time zone, on_duty_since timestamp with time zone, shifts_30d integer, hours_on_duty_30d numeric, last_shift_at timestamp with time zone, verifications_30d integer, admitted_30d integer, rejected_30d integer, offline_30d integer, flagged_30d integer, last_verification_at timestamp with time zone)
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

-- ─── JSON keys and column references renamed: replace in place ───────────────

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
      'licence_number', p.licence_number, 'licence_grade', p.licence_grade,
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
      'licence_number', p.licence_number, 'licence_grade', p.licence_grade,
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

create or replace function public.agency_roster(p_agency_id uuid)
 RETURNS TABLE(agency_membership_id uuid, full_name text, role agency_role, is_active boolean, registration_number text, grade text, registration_expires_at timestamp with time zone, registration_checked_at timestamp with time zone, estates_posted bigint)
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
         p.licence_grade,
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

create or replace function public.agency_monthly_return(p_agency_id uuid, p_month date)
 RETURNS TABLE(officer_name text, registration_number text, grade text, contact_phone text, registration_expires_at timestamp with time zone, registration_checked_at timestamp with time zone, estate_name text, estate_address text, first_shift_at timestamp with time zone, last_shift_at timestamp with time zone, shifts bigint, hours numeric)
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
    p.licence_grade,
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
  group by p.full_name, p.licence_number, p.licence_grade, p.phone,
           p.licence_expires_at, p.licence_verified_at, e.name, e.address
  order by p.full_name, e.name;
end;
$function$;

-- ─── The registration RPC, renamed ───────────────────────────────────────────

-- Nothing calls the old name: the dashboard's recordRegistration is not wired
-- to any screen yet, and no edge function uses it.
drop function public.record_psira_registration(uuid, text, text, timestamptz);

create function public.record_guard_licence(p_user_id uuid, p_licence_number text, p_grade text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
         licence_grade               = p_grade,
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

revoke execute on function public.record_guard_licence(uuid, text, text, timestamptz) from public, anon;
grant  execute on function public.record_guard_licence(uuid, text, text, timestamptz) to authenticated;

comment on function public.agency_monthly_return(uuid, date) is
  'Monthly personnel return assembled from stamped shifts (for a South African agency, PSIRA GN 2209).';
