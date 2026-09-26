-- Estate Access Platform — what an agency may read
--
-- The agency portal's entire privacy posture lives in these three functions.
-- Get them wrong and a guarding company can read the visitor history of forty
-- estates; get them right and the portal carries no privacy exposure at all.
--
-- ─── Why aggregates, and not a redacted row view ─────────────────────────────
--
-- The obvious design is "the same audit log, with names blanked". It is the
-- wrong one, for a reason that is legal before it is technical.
--
-- An operator processes personal information on a responsible party's behalf
-- and under its mandate. The moment an agency aggregates across estates for its
-- OWN purposes -- portfolio dashboards, SLA reporting, sales material -- it is
-- determining a purpose of its own, and it stops being an operator and becomes
-- a responsible party in its own right for that processing. Neither POPIA nor
-- Nigeria's NDPA has a joint-controller regime to soften that: each
-- co-determiner carries the full set of obligations. The EDPB reached the same
-- place on the analogous facts -- a provider building a cross-client asset it
-- profits from is a controller of it.
--
-- POPIA s6(1)(b) puts information "de-identified to the extent that it cannot
-- be re-identified again" outside the Act entirely. So a portal built on counts
-- carries no exposure, while the same portal built on blanked rows carries all
-- of it, because a blanked row is still a record about a person.
--
-- And counts are what an agency actually needs. It is monitoring its own
-- service: is the gate manned, are officers turning up, how many entries are
-- being refused. None of that requires knowing who visited whom.
--
-- PSIRA's Code of Conduct adds a second, independent reason. Clause 9(13)(b)
-- forbids a provider using a client's confidential information "to unfairly
-- compete with the client in business", and 9(11) requires disclosure where the
-- interests of different clients conflict. A cross-estate view of identifiable
-- visitor data engages both, whatever POPIA says.
--
-- RLS is NOT widened to accommodate any of this. Adding an
-- `or is_agency_for(estate_id)` arm to every table would put a permanent
-- cross-tenant read path on the whole schema for the sake of one screen -- the
-- same call already made for the operator dashboard. A definer function is one
-- reviewable door.

-- ─── Coverage: counts only, never rows ───────────────────────────────────────

create function public.agency_coverage_summary(
  p_agency_id uuid,
  p_from      timestamptz default (now() - interval '30 days'),
  p_to        timestamptz default now()
)
returns table (
  estate_id        uuid,
  estate_name      text,
  contract_live    boolean,
  officers         bigint,
  shifts           bigint,
  hours            numeric,
  entries_admitted bigint,
  entries_refused  bigint,
  entries_flagged  bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_agency_admin(p_agency_id) and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;

  return query
  with scoped as (
    -- Only estates this agency actually holds or held a contract at. An agency
    -- that has never worked an estate learns nothing about it here, not even
    -- that it exists.
    select c.estate_id, bool_or(c.during @> now() and c.revoked_at is null) as live
      from public.agency_contracts c
     where c.agency_id = p_agency_id
     group by c.estate_id
  ),
  shift_stats as (
    select s.estate_id,
           count(distinct s.membership_id) as officers,
           count(*) as shifts,
           round(sum(extract(epoch from
             (coalesce(s.ended_at, least(now(), p_to)) - s.started_at)) / 3600.0
           )::numeric, 2) as hours
      from public.guard_shifts s
     where s.agency_id = p_agency_id
       and s.started_at >= p_from and s.started_at < p_to
     group by s.estate_id
  ),
  event_stats as (
    -- Counts, grouped. No code, no resident, no guard, no timestamp of an
    -- individual entry -- nothing that is about a person rather than about the
    -- service. This is the whole privacy boundary, and it is one GROUP BY.
    select e.estate_id,
           count(*) filter (where e.outcome = 'admitted'
                              and e.admitted_without_match = false) as admitted,
           count(*) filter (where e.outcome in ('rejected', 'collision')) as refused,
           count(*) filter (where e.admitted_without_match) as flagged
      from public.verification_events e
     where e.agency_id = p_agency_id
       and e.synced_at >= p_from and e.synced_at < p_to
     group by e.estate_id
  )
  select sc.estate_id,
         es.name,
         sc.live,
         coalesce(ss.officers, 0),
         coalesce(ss.shifts, 0),
         coalesce(ss.hours, 0),
         coalesce(ev.admitted, 0),
         coalesce(ev.refused, 0),
         coalesce(ev.flagged, 0)
    from scoped sc
    join public.estates es on es.id = sc.estate_id
    left join shift_stats ss on ss.estate_id = sc.estate_id
    left join event_stats ev on ev.estate_id = sc.estate_id
   order by es.name;
end;
$$;

-- ─── Roster: the agency's OWN employees ──────────────────────────────────────
--
-- Personal data, and legitimately so: these are the agency's staff, it employs
-- them, and PSIRA's Code clause 11(2) obliges it to have verified their
-- registration before employing them. Nothing here touches an estate's
-- residents or visitors.

create function public.agency_roster(p_agency_id uuid)
returns table (
  agency_membership_id uuid,
  full_name            text,
  role                 public.agency_role,
  is_active            boolean,
  registration_number  text,
  grade                text,
  registration_expires_at timestamptz,
  registration_checked_at timestamptz,
  estates_posted       bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_agency_admin(p_agency_id) and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;

  return query
  select am.id,
         p.full_name,
         am.role,
         am.is_active,
         p.psira_registration_number,
         p.psira_grade,
         p.psira_expires_at,
         p.psira_verified_at,
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
$$;

-- ─── Which agencies does the caller administer ───────────────────────────────
--
-- The portal's entry point. Returns nothing rather than raising for a user who
-- administers none: "you are not an agency admin" is a routing answer, not an
-- error.

create function public.my_agencies()
returns table (
  agency_id           uuid,
  name                text,
  registration_number text,
  registration_body   text,
  registration_expires_at timestamptz,
  registration_checked_at timestamptz,
  role                public.agency_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.name, a.registration_number, a.registration_body,
         a.registration_expires_at, a.registration_verified_at, am.role
    from public.agency_memberships am
    join public.agencies a on a.id = am.agency_id
   where am.user_id = (select auth.uid())
     and am.is_active
   order by a.name;
$$;

revoke execute on function public.agency_coverage_summary(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.agency_roster(uuid) from public, anon;
revoke execute on function public.my_agencies() from public, anon;

grant execute on function public.agency_coverage_summary(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.agency_roster(uuid) to authenticated;
grant execute on function public.my_agencies() to authenticated;

-- Without this the coverage query scans every event in the table per estate.
create index verification_events_agency_synced_idx
  on public.verification_events (agency_id, synced_at)
  where agency_id is not null;
