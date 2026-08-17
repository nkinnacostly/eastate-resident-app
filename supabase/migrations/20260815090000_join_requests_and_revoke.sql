-- Estate Access Platform — joining an estate, and revoking a code
--
-- Closes the two gaps that block the estate admin dashboard:
--
--   1. A resident who signs up is invisible to the admin who must approve them.
--      The `profiles` admin policy requires an existing membership, and a new
--      signup has none, so there was no read path and no way to discover the
--      user id that grant_membership() needs.
--
--   2. Nothing could revoke a code. The `admin_revoked` enum value, the three
--      `revoked_*` columns and the tombstone branch of sync_pull all existed,
--      but no function ever set them — and access_codes deliberately has no
--      client write policy, so revocation HAS to be an RPC.

-- ─── generate_code: use the whole alphabet ───────────────────────────────────
--
-- BUG: the alphabet is 32 glyphs but the modulo was 31, so substr() could only
-- ever reach positions 1..31 — the digit '9' has never appeared in a single
-- code this system has issued. The same off-by-one biased the first 8 glyphs
-- (256 = 8*31 + 8), whereas 256 is an exact multiple of 32, making `% 32`
-- perfectly uniform. Fixing both.
create or replace function public.generate_code(p_len integer default 6)
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 glyphs
  v_bytes    bytea := extensions.gen_random_bytes(p_len);
  v_out      text := '';
  i          integer;
begin
  for i in 0 .. p_len - 1 loop
    -- 256 is a multiple of 32, so this is unbiased.
    v_out := v_out || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
  end loop;
  return v_out;
end;
$$;

-- ─── estates.join_code ───────────────────────────────────────────────────────
--
-- The estate hands this out (noticeboard, welcome pack). A resident types it at
-- sign-up, which routes their request to the right estate without publishing a
-- list of every estate on the platform to anyone who can reach the sign-up
-- screen.
--
-- 8 glyphs from the 32-glyph unambiguous alphabet = 32^8 ≈ 1.1e12. Not
-- guessable, but request_estate_access() is rate limited anyway: the code is a
-- routing token, not a secret, and it circulates on paper.

alter table public.estates
  add column if not exists join_code text;

-- Backfill one unique code per existing estate.
do $$
declare
  r        record;
  v_try    text;
begin
  for r in select id from public.estates where join_code is null loop
    loop
      v_try := public.generate_code(8);
      exit when not exists (select 1 from public.estates where join_code = v_try);
    end loop;
    update public.estates set join_code = v_try where id = r.id;
  end loop;
end $$;

alter table public.estates alter column join_code set not null;

-- Stored canonical: UPPERCASE, no separators. Input is normalised the same way
-- before comparison, so "kelvin-4821" and "KELVIN4821" both resolve.
create unique index if not exists estates_join_code_key
  on public.estates (join_code);

comment on column public.estates.join_code is
  'Routing token a resident types at sign-up. Stored uppercase without '
  'separators; normalise input before comparing. Rotatable by an estate admin.';

-- ─── join_requests ───────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'join_request_status') then
    create type public.join_request_status as enum ('pending', 'approved', 'declined');
  end if;
end $$;

create table if not exists public.join_requests (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  estate_id              uuid not null references public.estates (id) on delete cascade,
  -- What the applicant CLAIMS. The authoritative unit is memberships.unit,
  -- which only an admin sets when approving.
  requested_unit         text,
  status                 public.join_request_status not null default 'pending',
  created_at             timestamptz not null default now(),
  decided_at             timestamptz,
  decided_by_membership_id uuid references public.memberships (id),
  decline_reason         text
);

-- One OPEN request per person per estate. Declined and approved rows stay for
-- the audit trail, so this is partial rather than a plain unique constraint —
-- someone declined in error must be able to ask again.
create unique index if not exists join_requests_one_pending_idx
  on public.join_requests (user_id, estate_id)
  where status = 'pending';

create index if not exists join_requests_estate_status_idx
  on public.join_requests (estate_id, status, created_at desc);

-- ─── rate limiting ───────────────────────────────────────────────────────────
--
-- Keyed on user_id, NOT membership_id like code_mint_attempts: the whole point
-- of this call is that the caller has no membership yet.
create table if not exists public.join_attempts (
  user_id      uuid not null references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  hits         integer not null default 0,

  primary key (user_id, window_start)
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.join_requests enable row level security;
alter table public.join_attempts enable row level security;

-- SELECT only. Like access_codes, the sole write path is a definer function —
-- a client must not be able to approve its own request.
create policy "join_requests: read own or as estate admin"
  on public.join_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_membership(estate_id, 'admin')
  );

-- join_attempts gets RLS with NO policy and no grant: only SECURITY DEFINER
-- functions touch it, and a client that could read it could measure other
-- people's activity.

-- A policy without a matching GRANT is a dead letter (see 20260814100000).
grant select on public.join_requests to authenticated;

-- ─── request_estate_access ───────────────────────────────────────────────────

create or replace function public.request_estate_access(
  p_join_code text,
  p_unit      text default null
)
returns table (result text, estate_id uuid, estate_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_window   timestamptz := date_trunc('minute', now());
  v_limit    constant integer := 5;   -- requests per minute
  v_hits     integer;
  v_norm     text;
  v_estate   public.estates;
  v_unit     text := nullif(btrim(p_unit), '');
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Count the attempt BEFORE deciding anything, and never RAISE for an expected
  -- outcome: an exception aborts the transaction and rolls the counter back
  -- with it, so the limiter would only ever count successes (§3.2).
  insert into public.join_attempts (user_id, window_start, hits)
  values (v_user, v_window, 1)
  on conflict (user_id, window_start)
  do update set hits = join_attempts.hits + 1
  returning hits into v_hits;

  if v_hits > v_limit then
    return query select 'rate_limited'::text, null::uuid, null::text;
    return;
  end if;

  -- Normalise: strip anything that is not a letter or digit, then uppercase.
  -- Estates print the code with a dash; people type it with or without.
  v_norm := upper(regexp_replace(coalesce(p_join_code, ''), '[^A-Za-z0-9]', '', 'g'));

  select * into v_estate from public.estates where join_code = v_norm;

  if v_estate.id is null then
    return query select 'unknown_code'::text, null::uuid, null::text;
    return;
  end if;

  if exists (
    select 1 from public.memberships
     where user_id = v_user and estate_id = v_estate.id and is_active
  ) then
    return query select 'already_a_member'::text, v_estate.id, v_estate.name;
    return;
  end if;

  if exists (
    select 1 from public.join_requests
     where user_id = v_user and estate_id = v_estate.id and status = 'pending'
  ) then
    return query select 'already_pending'::text, v_estate.id, v_estate.name;
    return;
  end if;

  insert into public.join_requests (user_id, estate_id, requested_unit)
  values (v_user, v_estate.id, v_unit);

  return query select 'ok'::text, v_estate.id, v_estate.name;
end;
$$;

-- ─── approve_join_request ────────────────────────────────────────────────────

create or replace function public.approve_join_request(
  p_request_id uuid,
  p_unit       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req        public.join_requests;
  v_admin      uuid;
  v_membership uuid;
  v_unit       text;
begin
  select * into v_req from public.join_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  -- Authority is derived from the REQUEST's estate, never from a parameter —
  -- otherwise an admin at estate A could approve a request at estate B.
  v_admin := public.current_membership(v_req.estate_id, 'admin');
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'request_already_decided' using errcode = '22023';
  end if;

  -- The admin's correction wins over what the applicant typed.
  v_unit := coalesce(nullif(btrim(p_unit), ''), v_req.requested_unit);

  insert into public.memberships (user_id, estate_id, role, unit)
  values (v_req.user_id, v_req.estate_id, 'resident', v_unit)
  on conflict (user_id, estate_id, role)
  do update set
    is_active      = true,
    deactivated_at = null,
    unit           = coalesce(excluded.unit, memberships.unit)
  returning memberships.id into v_membership;

  update public.join_requests
     set status = 'approved',
         decided_at = now(),
         decided_by_membership_id = v_admin
   where id = p_request_id;

  return v_membership;
end;
$$;

-- ─── decline_join_request ────────────────────────────────────────────────────

create or replace function public.decline_join_request(
  p_request_id uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req   public.join_requests;
  v_admin uuid;
begin
  select * into v_req from public.join_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  v_admin := public.current_membership(v_req.estate_id, 'admin');
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'request_already_decided' using errcode = '22023';
  end if;

  update public.join_requests
     set status = 'declined',
         decided_at = now(),
         decided_by_membership_id = v_admin,
         decline_reason = nullif(btrim(p_reason), '')
   where id = p_request_id;
end;
$$;

-- ─── rotate_estate_join_code ─────────────────────────────────────────────────
--
-- A code printed on a noticeboard leaks. Rotating invalidates the old one
-- without touching anybody's existing membership.

create or replace function public.rotate_estate_join_code(p_estate_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_try text;
begin
  if public.current_membership(p_estate_id, 'admin') is null
     and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  loop
    v_try := public.generate_code(8);
    exit when not exists (select 1 from public.estates where join_code = v_try);
  end loop;

  update public.estates set join_code = v_try where id = p_estate_id;
  return v_try;
end;
$$;

-- ─── revoke_access_code ──────────────────────────────────────────────────────
--
-- Two callers, two reasons, one path:
--   an estate ADMIN cutting someone off  -> 'admin_revoked'
--   the RESIDENT who issued it, changing their mind -> 'resident_cancelled'
--
-- The UPDATE is conditional on status = 'active' for the same reason the burn
-- is: two admins clicking Revoke at once must not both "succeed", and a code
-- already used at the gate is history, not something to revoke.
--
-- Revoking bumps sync_seq via the existing trigger, so the next sync_pull emits
-- a TOMBSTONE and guards drop it from their pool. That is the whole point —
-- without it, revocation would never reach an offline gate.

create or replace function public.revoke_access_code(
  p_code_id uuid,
  p_reason  text default null
)
returns table (result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code    public.access_codes;
  v_admin   uuid;
  v_actor   uuid;
  v_reason  public.revoked_reason;
  v_updated integer;
begin
  select * into v_code from public.access_codes where id = p_code_id;
  if v_code.id is null then
    return query select 'not_found'::text;
    return;
  end if;

  v_admin := public.current_membership(v_code.estate_id, 'admin');

  if v_admin is not null then
    v_actor  := v_admin;
    v_reason := 'admin_revoked';
  elsif v_code.membership_id = public.current_membership(v_code.estate_id, 'resident') then
    v_actor  := v_code.membership_id;
    v_reason := 'resident_cancelled';
  else
    -- Not found rather than forbidden: a stranger must not be able to probe
    -- which code ids exist.
    return query select 'not_found'::text;
    return;
  end if;

  update public.access_codes
     set status                   = 'revoked',
         revoked_at               = now(),
         revoked_by_membership_id = v_actor,
         revoked_reason           = coalesce(
           nullif(btrim(p_reason), '')::public.revoked_reason, v_reason)
   where id = p_code_id
     and status = 'active'
     and swept_at is null;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return query select case v_code.status
                          when 'used'    then 'already_used'
                          when 'revoked' then 'already_revoked'
                          else 'not_found'
                        end::text;
    return;
  end if;

  return query select 'ok'::text;
end;
$$;

-- ─── grants ──────────────────────────────────────────────────────────────────
--
-- EXECUTE is granted to PUBLIC by default, so every new function is
-- anon-callable until explicitly revoked. Revoke first, then grant narrowly.

revoke execute on function public.request_estate_access(text, text)      from public, anon;
revoke execute on function public.approve_join_request(uuid, text)       from public, anon;
revoke execute on function public.decline_join_request(uuid, text)       from public, anon;
revoke execute on function public.rotate_estate_join_code(uuid)          from public, anon;
revoke execute on function public.revoke_access_code(uuid, text)         from public, anon;
revoke execute on function public.generate_code(integer)                 from public, anon;

grant execute on function public.request_estate_access(text, text)       to authenticated;
grant execute on function public.approve_join_request(uuid, text)        to authenticated;
grant execute on function public.decline_join_request(uuid, text)        to authenticated;
grant execute on function public.rotate_estate_join_code(uuid)           to authenticated;
grant execute on function public.revoke_access_code(uuid, text)          to authenticated;
