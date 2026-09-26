-- Estate Access Platform — officer registration and the statutory monthly return
--
-- South African law already specifies, in detail, a record every guarding
-- company must keep and file. Almost nobody automates it, and of thirty-odd
-- products surveyed across four markets not one models PSIRA, SIA, BSIS or any
-- other regulator as a first-class scheme -- they all store a generic
-- credential with a user-typed expiry date.
--
-- Two instruments matter here:
--
--   Regulation 10(7)(f) -- the POSTING SHEET. Per day or part-day: every
--   officer's names, their TRAINING GRADE, their REGISTRATION NUMBER, the
--   client's name, the ADDRESS where the service was rendered, its nature, and
--   its DURATION IN HOURS. That is a schema, written into law in 2002, that
--   most companies still satisfy on paper.
--
--   GN 2209 of 2023, in force 1 April 2024 -- a MONTHLY return, due by the
--   15th, of every officer employed or deployed that month: full names, ID
--   numbers, contact numbers, registration numbers, period of service and
--   geographic area. A materially false or misleading return carries a penalty
--   of up to R500,000.
--
-- The reason we can produce this and a gate-device product cannot is that we
-- authenticate a PERSON. Across the Indian market -- the largest in the world
-- for this software -- the credential is a gate or a post: one shared tablet
-- per gate with a PIN, a locked handset, a dropdown of posts. A system that
-- authenticates a device can never say which human was at the gate, so it can
-- never produce reg 10(7)(f). We already record it on every shift and every
-- verification. This migration only reads it back.

-- ─── Registration is the PERSON's ────────────────────────────────────────────
--
-- On profiles, not memberships, and that is PSIRA's own model rather than our
-- interpretation of it. The officer applies in their own name, pays their own
-- R310, submits their own fingerprints, and keeps the registration when they
-- change employer; what changes is a "link" to a business, which flips them
-- between Active and Inactive. Their FAQ: "Inactive means that you are
-- currently not employed or linked to any security business."
--
-- The scale of that split is the argument against ever storing it per-estate:
-- 2.92 million registered officers, 638,000 of them active. Registration
-- outlives employment by a wide margin.

alter table public.profiles add column psira_registration_number text;

-- Opaque. PSIRA prescribes no digit count, no check digit and no prefix
-- anywhere in the Act or the Regulations, so a format check would enforce a
-- rule that does not exist and reject valid numbers. It also has to hold an
-- NSCDC approval number, which has a different shape again.
comment on column public.profiles.psira_registration_number is
  'Regulator registration, person-scoped and portable between employers. '
  'Opaque string: no regulator publishes a format to validate against.';

-- A-E, with E the registration floor and B the floor for a company''s own
-- directors. Text with a CHECK rather than an enum because grades are a policy
-- artefact of PSIRA''s training regulations, not statute -- and because Nigeria
-- has no grading ladder at all, so this must be nullable without apology.
alter table public.profiles add column psira_grade text;
alter table public.profiles
  add constraint profiles_psira_grade_ck
  check (psira_grade is null or psira_grade in ('A', 'B', 'C', 'D', 'E'));

alter table public.profiles add column psira_expires_at  timestamptz;

-- The field nobody else stores, and the one that carries the truth.
--
-- An unexpired date says nothing about a registration suspended yesterday. The
-- only product found anywhere that re-checks against a regulator does it daily;
-- everyone else trusts a date the employer typed in. We cannot re-check
-- automatically -- PSIRA publishes no API, only a JavaScript portal over an
-- undocumented third-party endpoint, and scraping it would be both fragile and
-- unacceptable -- so what we can honestly record is that a human looked, and
-- when. The absence of a value here is itself information.
alter table public.profiles add column psira_verified_at timestamptz;

comment on column public.profiles.psira_verified_at is
  'When a human last checked this against the regulator. Never set '
  'automatically: there is no public API to check against, so the honest '
  'claim is "checked on this date", not "verified".';

-- ─── The return ──────────────────────────────────────────────────────────────

create function public.agency_monthly_return(p_agency_id uuid, p_month date)
returns table (
  officer_name        text,
  registration_number text,
  grade               text,
  contact_phone       text,
  registration_expires_at timestamptz,
  registration_checked_at timestamptz,
  estate_name         text,
  -- "Geographic area of service", in the words of the return.
  estate_address      text,
  first_shift_at      timestamptz,
  last_shift_at       timestamptz,
  shifts              bigint,
  hours               numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    p.psira_registration_number,
    p.psira_grade,
    p.phone,
    p.psira_expires_at,
    p.psira_verified_at,
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
  group by p.full_name, p.psira_registration_number, p.psira_grade, p.phone,
           p.psira_expires_at, p.psira_verified_at, e.name, e.address
  order by p.full_name, e.name;
end;
$$;

comment on function public.agency_monthly_return(uuid, date) is
  'PSIRA GN 2209 monthly personnel return, assembled from stamped shifts. '
  'One row per officer per estate worked that month.';

revoke execute on function public.agency_monthly_return(uuid, date) from public, anon;
grant  execute on function public.agency_monthly_return(uuid, date) to authenticated;

-- Reads the return's whole span in one index scan rather than a table scan per
-- month, which is what this query would otherwise degrade into as shifts
-- accumulate over the four years PSIRA requires them kept.
create index guard_shifts_agency_month_idx
  on public.guard_shifts (agency_id, started_at)
  where agency_id is not null;
