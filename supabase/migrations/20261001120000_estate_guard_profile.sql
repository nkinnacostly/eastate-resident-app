-- Estate Access Platform — a guard's profile, for the estate admin
--
-- Clicking a guard on the dashboard opens who they are and how they work the
-- gate: contact details, licence, the agency that placed them, whether they are
-- on duty now, their shifts, and what they verified.
--
-- RPCs rather than table reads because two of those facts live where no client
-- can read them: the sign-in email and last sign-in are in auth.users, and the
-- agency name is behind the agency portal's own policies.
--
-- p_guard_membership_id names the guard being LOOKED AT, never the caller. The
-- caller's identity still comes only from auth.uid() via current_membership(),
-- and the target must be a guard membership at the estate the caller
-- administers -- otherwise an admin at estate A could read estate B's guards by
-- guessing an id.

create function public.estate_guard_profile(p_estate_id uuid, p_guard_membership_id uuid)
returns table (
  membership_id        uuid,
  user_id              uuid,
  full_name            text,
  phone                text,
  email                text,
  is_active            boolean,
  joined_at            timestamptz,
  last_sign_in_at      timestamptz,
  agency_name          text,
  psira_registration_number text,
  psira_grade          text,
  psira_expires_at     timestamptz,
  psira_verified_at    timestamptz,
  on_duty_since        timestamptz,
  shifts_30d           integer,
  hours_on_duty_30d    numeric,
  last_shift_at        timestamptz,
  verifications_30d    integer,
  admitted_30d         integer,
  rejected_30d         integer,
  offline_30d          integer,
  flagged_30d          integer,
  last_verification_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since constant timestamptz := now() - interval '30 days';
begin
  if p_estate_id is null or public.current_membership(p_estate_id, 'admin') is null then
    raise exception 'not_an_estate_admin' using errcode = '42501';
  end if;

  return query
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
    p.psira_registration_number,
    p.psira_grade,
    p.psira_expires_at,
    p.psira_verified_at,
    (select s.started_at from public.guard_shifts s
      where s.membership_id = m.id and s.ended_at is null
      order by s.started_at desc limit 1),
    (select count(*) from public.guard_shifts s
      where s.membership_id = m.id
        and coalesce(s.ended_at, now()) > v_since)::integer,
    -- Clipped to the window, so a shift that began 31 days ago counts only the
    -- part that falls inside it. Shift times are SERVER times (column default
    -- and the end_shift RPC), so this does not depend on a phone's clock.
    round((select coalesce(sum(extract(epoch from
              least(coalesce(s.ended_at, now()), now()) - greatest(s.started_at, v_since))), 0)
             from public.guard_shifts s
            where s.membership_id = m.id
              and coalesce(s.ended_at, now()) > v_since) / 3600.0, 1),
    (select max(s.started_at) from public.guard_shifts s where s.membership_id = m.id),
    -- Windowed on synced_at, the server clock, as the operator dashboard is.
    -- verified_at is the device's claim.
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > v_since)::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > v_since
        and v.outcome = 'admitted')::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > v_since
        and v.outcome in ('rejected', 'collision'))::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > v_since
        and v.source = 'offline_replay')::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > v_since
        and v.admitted_without_match)::integer,
    (select max(v.synced_at) from public.verification_events v
      where v.verified_by_membership_id = m.id)
  from public.memberships m
  join auth.users u          on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  left join public.agencies a on a.id = m.placed_by_agency_id
  where m.id = p_guard_membership_id
    and m.estate_id = p_estate_id
    and m.role = 'guard';
end;
$$;

revoke execute on function public.estate_guard_profile(uuid, uuid) from public, anon;
grant  execute on function public.estate_guard_profile(uuid, uuid) to authenticated;

-- ─── Shift history ───────────────────────────────────────────────────────────

create function public.estate_guard_shifts(
  p_estate_id uuid,
  p_guard_membership_id uuid,
  p_limit integer default 50
)
returns table (
  shift_id          uuid,
  started_at        timestamptz,
  ended_at          timestamptz,
  ended_by_handover boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_estate_id is null or public.current_membership(p_estate_id, 'admin') is null then
    raise exception 'not_an_estate_admin' using errcode = '42501';
  end if;

  return query
  select s.id, s.started_at, s.ended_at, s.ended_by_handover
    from public.guard_shifts s
    join public.memberships m on m.id = s.membership_id
   where s.membership_id = p_guard_membership_id
     and s.estate_id = p_estate_id
     and m.estate_id = p_estate_id
     and m.role = 'guard'
   order by s.started_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$$;

revoke execute on function public.estate_guard_shifts(uuid, uuid, integer) from public, anon;
grant  execute on function public.estate_guard_shifts(uuid, uuid, integer) to authenticated;
