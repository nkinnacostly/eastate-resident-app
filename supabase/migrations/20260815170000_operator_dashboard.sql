-- Platform-owner (operator) dashboard.
--
-- Every function here is SECURITY DEFINER and gated on is_platform_admin().
-- That is deliberately different from the estate-admin dashboard, which reads
-- tables directly under RLS: the operator's whole job is to look ACROSS
-- estates, and the alternative — widening `estates`, `houses`, `memberships`
-- and `verification_events` policies with an `or is_platform_admin()` arm —
-- would put a cross-tenant read path on every table in the schema, permanently,
-- for the sake of one screen. A definer function is a single reviewable door.
--
-- Nothing here can reach a live code. The operator sees that a verification
-- happened, never the characters that were typed.

-- ─── forced password change ──────────────────────────────────────────────────
--
-- Onboarding an estate mints the admin's account with a generated password that
-- a human reads off a screen and passes on. That password has been seen by at
-- least two people by the time it is first used, so the account is flagged
-- until it is replaced.
--
-- This is a prompt, not a security boundary — the person who could bypass it is
-- the person the password was handed to, and they already own the account. What
-- it prevents is the handover password quietly staying in place for a year.

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- The client may update its own profile row (see "profiles: update own"), so
-- without this a user could clear their own flag by writing the column
-- directly. Column-level privileges are checked before policies, same as table
-- ones — this makes the RPC below the only way to clear it.
revoke update (must_change_password) on public.profiles from authenticated;

create or replace function public.clear_must_change_password()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set must_change_password = false
   where id = (select auth.uid());
$$;

revoke execute on function public.clear_must_change_password() from public;
grant execute on function public.clear_must_change_password() to authenticated;

-- ─── operator_find_user_by_email ─────────────────────────────────────────────
--
-- One person can administer more than one estate, so onboarding has to be able
-- to find an existing account rather than failing on "email already
-- registered". Platform-admin only: this answers "does this address have an
-- account", which is not a question anyone else may ask.

create or replace function public.operator_find_user_by_email(p_email text)
returns table (user_id uuid, full_name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  return query
    select u.id, p.full_name
      from auth.users u
      left join public.profiles p on p.id = u.id
     where lower(u.email) = lower(btrim(p_email));
end;
$$;

revoke execute on function public.operator_find_user_by_email(text) from public;
grant execute on function public.operator_find_user_by_email(text) to authenticated;

-- ─── operator_portfolio ──────────────────────────────────────────────────────
--
-- "Live" is derived from whether an estate has an active admin, not stored as a
-- status column. An estate with no admin cannot onboard a house, so nothing can
-- reach the gate — that IS the onboarding state, and deriving it means it can
-- never drift out of step with reality the way a hand-maintained flag would.

create or replace function public.operator_portfolio()
returns table (
  estates_total      integer,
  estates_live       integer,
  estates_onboarding integer,
  houses_total       integer,
  residents_total    integer,
  guards_total       integer,
  admins_total       integer,
  verifications_30d  integer,
  admitted_30d       integer,
  rejected_30d       integer,
  offline_30d        integer,
  flagged_30d        integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  return query
  with adminned as (
    select distinct m.estate_id from public.memberships m
     where m.role = 'admin' and m.is_active
  ),
  ev as (
    -- Windowed on synced_at, the SERVER clock. verified_at is the device's
    -- claim; a phone with a wrong year would otherwise drag events in and out
    -- of the window at random.
    select * from public.verification_events v
     where v.synced_at > now() - interval '30 days'
  )
  select
    (select count(*) from public.estates)::integer,
    (select count(*) from public.estates e where e.id in (select estate_id from adminned))::integer,
    (select count(*) from public.estates e where e.id not in (select estate_id from adminned))::integer,
    (select count(*) from public.houses)::integer,
    (select count(*) from public.memberships m where m.role = 'resident' and m.is_active)::integer,
    (select count(*) from public.memberships m where m.role = 'guard'    and m.is_active)::integer,
    (select count(*) from public.memberships m where m.role = 'admin'    and m.is_active)::integer,
    (select count(*) from ev)::integer,
    (select count(*) from ev where ev.outcome = 'admitted')::integer,
    (select count(*) from ev where ev.outcome = 'rejected')::integer,
    (select count(*) from ev where ev.source  = 'offline_replay')::integer,
    -- Flagged is DERIVED the same way the estate dashboard derives it: a guard
    -- admitted a code the phone could not resolve. Keeping the definition in
    -- one shape across both dashboards matters more than a stored column.
    (select count(*) from ev
      where ev.outcome = 'admitted' and ev.source = 'offline_replay' and ev.code_id is null)::integer;
end;
$$;

revoke execute on function public.operator_portfolio() from public;
grant execute on function public.operator_portfolio() to authenticated;

-- ─── operator_estates ────────────────────────────────────────────────────────

create or replace function public.operator_estates()
returns table (
  id                uuid,
  name              text,
  address           text,
  join_code         text,
  is_active         boolean,
  created_at        timestamptz,
  houses            integer,
  residents         integer,
  guards            integer,
  admin_name        text,
  admin_email       text,
  admin_count       integer,
  verifications_30d integer,
  flagged_30d       integer,
  last_activity     timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  return query
  select
    e.id,
    e.name,
    e.address,
    e.join_code,
    e.is_active,
    e.created_at,
    (select count(*) from public.houses h where h.estate_id = e.id)::integer,
    (select count(*) from public.memberships m
      where m.estate_id = e.id and m.role = 'resident' and m.is_active)::integer,
    (select count(*) from public.memberships m
      where m.estate_id = e.id and m.role = 'guard' and m.is_active)::integer,
    -- The longest-standing active admin is the one shown. Picking arbitrarily
    -- would make the column flicker between reloads.
    (select p.full_name from public.memberships m
       join public.profiles p on p.id = m.user_id
      where m.estate_id = e.id and m.role = 'admin' and m.is_active
      order by m.created_at limit 1),
    (select u.email::text from public.memberships m
       join auth.users u on u.id = m.user_id
      where m.estate_id = e.id and m.role = 'admin' and m.is_active
      order by m.created_at limit 1),
    (select count(*) from public.memberships m
      where m.estate_id = e.id and m.role = 'admin' and m.is_active)::integer,
    (select count(*) from public.verification_events v
      where v.estate_id = e.id and v.synced_at > now() - interval '30 days')::integer,
    (select count(*) from public.verification_events v
      where v.estate_id = e.id and v.synced_at > now() - interval '30 days'
        and v.outcome = 'admitted' and v.source = 'offline_replay' and v.code_id is null)::integer,
    (select max(v.synced_at) from public.verification_events v where v.estate_id = e.id)
  from public.estates e
  order by e.created_at desc;
end;
$$;

revoke execute on function public.operator_estates() from public;
grant execute on function public.operator_estates() to authenticated;

-- ─── operator_admins ─────────────────────────────────────────────────────────
--
-- last_sign_in_at comes from auth.users, which only a definer function can
-- read. It is the real thing, not a proxy: "never signed in" is exactly the
-- signal that an onboarding has stalled.

create or replace function public.operator_admins()
returns table (
  user_id         uuid,
  full_name       text,
  email           text,
  estate_id       uuid,
  estate_name     text,
  is_active       boolean,
  granted_at      timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    p.full_name,
    u.email::text,
    m.estate_id,
    e.name,
    m.is_active,
    m.created_at,
    u.last_sign_in_at
  from public.memberships m
  join public.estates  e on e.id = m.estate_id
  join auth.users      u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.role = 'admin'
  order by u.last_sign_in_at desc nulls last, e.name;
end;
$$;

revoke execute on function public.operator_admins() from public;
grant execute on function public.operator_admins() to authenticated;

-- ─── operator_platform_team ──────────────────────────────────────────────────

create or replace function public.operator_platform_team()
returns table (
  user_id         uuid,
  full_name       text,
  email           text,
  created_at      timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  return query
  select pa.user_id, p.full_name, u.email::text, pa.created_at, u.last_sign_in_at
    from public.platform_admins pa
    join auth.users u on u.id = pa.user_id
    left join public.profiles p on p.id = pa.user_id
   order by pa.created_at;
end;
$$;

revoke execute on function public.operator_platform_team() from public;
grant execute on function public.operator_platform_team() to authenticated;

-- ─── operator_health ─────────────────────────────────────────────────────────
--
-- Sync lag is the honest version of "queued, unsynced": the server cannot see
-- what is still sitting on a guard's phone — that is the whole point of the
-- offline design — but it can see how long each event that DID arrive spent in
-- the queue. A rising lag is the same signal, measured from the only side that
-- has the data.
--
-- verified_at is used here on purpose, and only here: the gap between the
-- device clock and the server clock IS the measurement. It is clamped at zero
-- because a phone running fast would otherwise report negative lag.

create or replace function public.operator_health()
returns table (
  estate_id            uuid,
  estate_name          text,
  verifications_30d    integer,
  offline_30d          integer,
  offline_share        numeric,
  flagged_30d          integer,
  median_lag_seconds   numeric,
  worst_lag_seconds    numeric,
  stale_pool_worst_age integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  return query
  select
    e.id,
    e.name,
    count(v.id)::integer,
    count(v.id) filter (where v.source = 'offline_replay')::integer,
    case when count(v.id) = 0 then 0::numeric
         else round(100.0 * count(v.id) filter (where v.source = 'offline_replay') / count(v.id), 1)
    end,
    count(v.id) filter (
      where v.outcome = 'admitted' and v.source = 'offline_replay' and v.code_id is null
    )::integer,
    -- percentile_cont returns double precision, which does not implicitly
    -- coerce to the numeric this function declares — the mismatch is a runtime
    -- 42804, invisible until the row actually comes back.
    percentile_cont(0.5) within group (
      order by greatest(0, extract(epoch from (v.synced_at - v.verified_at)))
    ) filter (where v.source = 'offline_replay')::numeric,
    max(greatest(0, extract(epoch from (v.synced_at - v.verified_at))))
      filter (where v.source = 'offline_replay')::numeric,
    max(v.pool_age_seconds)::integer
  from public.estates e
  left join public.verification_events v
    on v.estate_id = e.id and v.synced_at > now() - interval '30 days'
  group by e.id, e.name
  order by count(v.id) desc;
end;
$$;

revoke execute on function public.operator_health() from public;
grant execute on function public.operator_health() to authenticated;

-- ─── operator_daily_volume ───────────────────────────────────────────────────
--
-- generate_series, not a group-by over the events: a day with no verifications
-- has to appear as a zero-height bar. Grouping alone silently drops it, and a
-- chart that skips quiet days misreports the shape of a week.

create or replace function public.operator_daily_volume(p_days integer default 30)
returns table (
  day           date,
  verifications integer,
  admitted      integer,
  offline       integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  return query
  select
    d.d::date,
    count(v.id)::integer,
    count(v.id) filter (where v.outcome = 'admitted')::integer,
    count(v.id) filter (where v.source  = 'offline_replay')::integer
  from generate_series(
         (current_date - (v_days - 1))::timestamptz,
         current_date::timestamptz,
         interval '1 day'
       ) as d(d)
  left join public.verification_events v
    on v.synced_at >= d.d and v.synced_at < d.d + interval '1 day'
  group by d.d
  order by d.d;
end;
$$;

revoke execute on function public.operator_daily_volume(integer) from public;
grant execute on function public.operator_daily_volume(integer) to authenticated;
