-- Estate Access Platform — security agencies
--
-- Estates do not usually employ their guards. They sign a contract with a
-- security company, which deploys officers and rotates them. Neither the PRD
-- nor the Technical Design mentions that company, which is a gap in the source
-- of truth rather than an implementation detail -- both need amending to match
-- this file.
--
-- ─── The decision this file encodes ──────────────────────────────────────────
--
-- The estate stays the tenant. The agency is an actor inside it, never above it.
--
-- Every guard-workforce product does the opposite: the agency is the tenant and
-- client sites hang off it (TrackTik's "Sites (Client)", GuardTek's numbered
-- Client/Site/Location/Post). That inversion is why none of them can answer the
-- question an estate actually asks -- "what happens to our gate log when we
-- change security companies?" In those products the log belongs to the agency
-- and leaves with it; one vendor destroys it twenty days after the contract
-- ends. Keeping the estate as the tenant makes changeover a membership change
-- and nothing else, with the history staying where it was always the estate's.
--
-- ─── Authorisation and provenance are different questions ────────────────────
--
-- This is the distinction the whole file turns on, and conflating them is the
-- mistake that is expensive to undo.
--
--   AUTHORISATION is always about NOW: may this person open this gate today?
--   Overwriting it is correct -- when an officer is reassigned, the new answer
--   replaces the old one and the old one is of no further use.
--
--   PROVENANCE is about THEN: on the night of the incident, who was on the
--   gate and who had placed them there? It must never change. If it were
--   derived from the authorisation records, then re-assigning an officer next
--   March would silently rewrite last November's audit trail, attributing a
--   decision to a company that had nothing to do with it.
--
-- So authorisation lives on memberships (mutable, one row per person per
-- estate) and provenance is STAMPED onto each event and shift as it is written
-- (immutable, one value per row, never updated). An event recorded without a
-- stamp can never have a truthful one added later, which is why this migration
-- is worth doing before the first agency is onboarded rather than after.

-- ─── Agencies ────────────────────────────────────────────────────────────────

create table public.agencies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,

  -- PSIRA in South Africa, NSCDC (under the Private Guard Companies Act) in
  -- Nigeria. Stored as an OPAQUE STRING and deliberately not validated: PSIRA
  -- prescribes no format for a registration number anywhere in the Act or the
  -- Regulations, so a client-side pattern check would invent a rule the
  -- regulator has not made and reject numbers that are perfectly valid.
  registration_number text,
  -- ISO 3166-1 alpha-2. Which regulator the number belongs to; without it a
  -- bare number cannot be checked against anything.
  registration_body   text,

  -- When someone last looked the registration up and what they saw.
  --
  -- An unexpired date proves nothing about a registration suspended yesterday,
  -- and of every product surveyed only one anywhere re-checks against a
  -- regulator at all. Neither PSIRA nor the NSCDC publishes an API -- PSIRA's
  -- portal is a JavaScript shell over an undocumented third-party endpoint and
  -- the NSCDC's linked portal does not resolve -- so this is a human
  -- attestation, and it is recorded as one. The freshness is the point: the
  -- honest claim is "checked on this date", never "verified".
  registration_verified_at timestamptz,
  registration_expires_at  timestamptz,

  created_at timestamptz not null default now()
);

comment on table public.agencies is
  'A security company that supplies guards to estates. Never a tenant: the '
  'estate is the tenant and this is an actor inside it.';

-- ─── Who works for the agency ────────────────────────────────────────────────
--
-- Deliberately a SECOND membership concept alongside public.memberships, not a
-- widening of it. The locked decision says a memberships row links a user to an
-- ESTATE, and making estate_id nullable to squeeze agencies in would put a null
-- branch into the single table every RLS policy and every RPC depends on -- the
-- highest blast radius available, for no benefit.
--
-- It is an extension rather than a contradiction because an agency membership
-- grants NOTHING at any estate by itself. It says who employs this person.

create type public.agency_role as enum ('officer', 'admin');

create table public.agency_memberships (
  id         uuid primary key default gen_random_uuid(),
  agency_id  uuid not null references public.agencies (id) on delete cascade,
  user_id    uuid not null references auth.users (id)      on delete cascade,
  role       public.agency_role not null default 'officer',

  -- The single write that ends someone's employment everywhere at once.
  --
  -- This is the property the whole shape exists for. The alternative -- a row
  -- per estate, deactivated one at a time -- is a fan-out write, and a fan-out
  -- that dies at estate four of nine leaves a dismissed officer working at five
  -- estates with no invariant that can detect it, because the rows ARE the
  -- truth. Microsoft rebuilt partner access (DAP to GDAP) around exactly this:
  -- staff sit in a group at the provider, and removing them there removes
  -- access at every customer simultaneously.
  is_active  boolean not null default true,

  created_at timestamptz not null default now(),

  -- One employment record per person per agency. Rejoining flips is_active
  -- rather than adding a row, so history has one place to live.
  unique (agency_id, user_id)
);

create index agency_memberships_user_idx
  on public.agency_memberships (user_id) where is_active;

-- ─── The contract between an agency and an estate ────────────────────────────

create extension if not exists btree_gist;

create table public.agency_contracts (
  id        uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  estate_id uuid not null references public.estates (id)  on delete cascade,

  starts_on timestamptz not null default now(),
  -- Null means open-ended, which is the normal case: a guarding contract runs
  -- until somebody ends it.
  ends_on   timestamptz,

  -- Ending a contract is an ACT, with a time, not the absence of one. Same
  -- reasoning as revoked-versus-expired on a code: an audit has to tell "the
  -- term ran out" apart from "the estate terminated them".
  revoked_at timestamptz,

  created_at timestamptz not null default now(),

  constraint agency_contracts_ends_after_start
    check (ends_on is null or ends_on > starts_on)
);

-- Generated, not maintained. There is deliberately no `is_active` boolean kept
-- current by a cron job: that is the stored-`expired` mistake made a second
-- time, and a janitor that falls over becomes a gate that admits the wrong
-- people. Liveness is derived, always, from `during @> now()`.
alter table public.agency_contracts
  add column during tstzrange
  generated always as (tstzrange(starts_on, ends_on, '[)')) stored;

-- Two things for the price of one: it makes overlapping contracts for the same
-- agency at the same estate impossible, and it is the GiST index that
-- `during @> now()` scans. Note `now()` is STABLE, not IMMUTABLE, so it cannot
-- appear in an index PREDICATE -- but it is perfectly legal as a scan
-- condition, so the index is used.
alter table public.agency_contracts
  add constraint agency_contracts_no_overlap
  exclude using gist (agency_id with =, estate_id with =, during with &&);

create index agency_contracts_estate_idx on public.agency_contracts (estate_id);

-- ─── Authorisation: which agency placed this guard ───────────────────────────
--
-- On memberships, because that is the authorisation record and this is an
-- authorisation fact. Null for a guard the estate employs directly -- in-house
-- security is a real and legally distinct arrangement (Nigeria's Private Guard
-- Companies Act s36(3)(b) exempts it from the Act entirely; South Africa's
-- Code of Conduct clause 23 does not), so this must not be made mandatory.

alter table public.memberships
  add column placed_by_agency_id uuid references public.agencies (id) on delete set null;

comment on column public.memberships.placed_by_agency_id is
  'Which agency placed this guard, NOW. Overwritten on reassignment -- history '
  'lives on the stamped agency_id of each event and shift, never here.';

-- ─── Provenance: stamped once, never updated ─────────────────────────────────

alter table public.verification_events add column agency_id uuid references public.agencies (id);
alter table public.guard_shifts        add column agency_id uuid references public.agencies (id);

comment on column public.verification_events.agency_id is
  'Who was responsible at the moment this was recorded. Immutable. Survives '
  'de-identification: an agency is a company, not a person.';

-- A trigger, NOT a change to _ingest_verification_event.
--
-- The stamp has to happen at write time or it is worthless, but the ingest
-- function is the atomic conditional burn -- the single most dangerous piece of
-- SQL in the schema, and the one place a mistake double-admits a visitor.
-- A BEFORE INSERT trigger gets identical timing and identical immutability
-- without reopening it.
create function public.stamp_agency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only ever on insert, and only when not already supplied.
  if new.agency_id is null and new.verified_by_membership_id is not null then
    select m.placed_by_agency_id into new.agency_id
      from public.memberships m
     where m.id = new.verified_by_membership_id;
  end if;
  return new;
end;
$$;

create trigger verification_events_stamp_agency
  before insert on public.verification_events
  for each row execute function public.stamp_agency();

create function public.stamp_shift_agency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agency_id is null then
    select m.placed_by_agency_id into new.agency_id
      from public.memberships m
     where m.id = new.membership_id;
  end if;
  return new;
end;
$$;

create trigger guard_shifts_stamp_agency
  before insert on public.guard_shifts
  for each row execute function public.stamp_shift_agency();

-- Make "never updated" enforced rather than merely intended. Nothing in the
-- schema updates these today; this is what stops something doing so in a year
-- and quietly rewriting who was responsible on the night of an incident.
create function public.freeze_agency_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.agency_id is distinct from new.agency_id then
    raise exception 'agency_id is provenance and cannot be changed'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger verification_events_freeze_agency
  before update on public.verification_events
  for each row execute function public.freeze_agency_stamp();

create trigger guard_shifts_freeze_agency
  before update on public.guard_shifts
  for each row execute function public.freeze_agency_stamp();

-- ─── Cross-estate revocation ─────────────────────────────────────────────────

create function public.agency_deactivate_officer(p_agency_membership_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid;
  v_agency   uuid;
  v_affected integer;
begin
  -- Identity from auth.uid(), never from a parameter. The caller must be an
  -- active admin OF THE AGENCY that employs this officer.
  select am.user_id, am.agency_id into v_user, v_agency
    from public.agency_memberships am
   where am.id = p_agency_membership_id;

  if v_user is null then
    raise exception 'no_such_agency_membership' using errcode = '42704';
  end if;

  if not exists (
    select 1 from public.agency_memberships caller
     where caller.agency_id = v_agency
       and caller.user_id   = (select auth.uid())
       and caller.role      = 'admin'
       and caller.is_active
  ) and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;

  update public.agency_memberships set is_active = false
   where id = p_agency_membership_id;

  -- The estate memberships this agency placed are withdrawn with it. Scoped to
  -- placed_by_agency_id: an estate that also employs this person directly, or
  -- a post another agency placed them in, is none of this caller's business.
  --
  -- The estate keeps its own authority. This is a SECOND route to revocation,
  -- not a replacement -- an estate admin may still deactivate a guard the
  -- agency has not, and the agency may still withdraw someone the estate is
  -- happy with. Both directions exist because both parties carry real risk.
  update public.memberships m
     set is_active = false
   where m.user_id = v_user
     and m.role = 'guard'
     and m.is_active
     and m.placed_by_agency_id = v_agency;
  get diagnostics v_affected = row_count;

  return v_affected;
end;
$$;

revoke execute on function public.agency_deactivate_officer(uuid) from public, anon;
grant  execute on function public.agency_deactivate_officer(uuid) to authenticated;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
--
-- Policies alone do nothing: Postgres checks table privileges BEFORE policies,
-- so a SELECT policy without a matching GRANT fails with 42501 while the policy
-- list looks perfectly correct.

alter table public.agencies           enable row level security;
alter table public.agency_memberships enable row level security;
alter table public.agency_contracts   enable row level security;

grant select on public.agencies           to authenticated;
grant select on public.agency_memberships to authenticated;
grant select on public.agency_contracts   to authenticated;

-- Definer, in a private schema, to break the recursion: a policy on
-- agency_memberships that itself queries agency_memberships is 42P17.
create schema if not exists private;

create function private.caller_agency_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select am.agency_id
    from public.agency_memberships am
   where am.user_id = (select auth.uid())
     and am.is_active;
$$;

-- IN (SELECT ...) rather than a correlated EXISTS. The wrapper trick that makes
-- (select auth.uid()) fast works because an UNCORRELATED sub-select becomes an
-- InitPlan evaluated once; a correlated EXISTS stays a per-row SubPlan however
-- it is written. Supabase's own benchmark for this rewrite is 9,000ms -> 20ms.
create policy "read own agency" on public.agencies
  for select to authenticated
  using (id in (select private.caller_agency_ids()) or public.is_platform_admin());

create policy "read own agency roster" on public.agency_memberships
  for select to authenticated
  using (agency_id in (select private.caller_agency_ids()) or public.is_platform_admin());

-- An estate admin can see who is contracted to their estate; an agency can see
-- its own contracts. Neither can see the other's wider book of business.
create policy "read contracts on either side" on public.agency_contracts
  for select to authenticated
  using (
    agency_id in (select private.caller_agency_ids())
    or public.current_membership(estate_id, 'admin') is not null
    or public.is_platform_admin()
  );

-- No INSERT/UPDATE/DELETE policy anywhere above. Writes go through definer
-- RPCs, exactly as they do for access_codes and verification_events -- the
-- missing policy is what makes that the only path.
