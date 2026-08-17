-- Houses: the missing middle of the hierarchy.
--
--   platform owner  -> estate        (estate join code, 8 glyphs)
--   estate admin    -> house         (house code, 4 glyphs, unique PER ESTATE)
--   resident        -> enters both   -> lands in one house
--
-- Until now a resident attached straight to an estate with a free-text `unit`,
-- which meant the unit was a label nobody owned: two residents in the same
-- house could type it differently ("14", "no 14", "Unit 14") and nothing
-- connected them. A house is now a row, and residents attach to it.
--
-- The landlord is a FIELD on the house, not a user. They never sign in. That
-- keeps the role enum, the RLS matrix and the auth surface exactly as they are
-- — and a landlord can be promoted to a real user later without migrating a
-- single resident.

create table if not exists public.houses (
  id             uuid primary key default gen_random_uuid(),
  estate_id      uuid not null references public.estates (id) on delete cascade,

  -- Short because it is scoped to one estate: 32^4 ≈ 1.05M per estate, and it
  -- gets printed on a letter and typed by hand.
  house_code     text not null default public.generate_code(4),
  house_number   text not null,

  -- Nullable on purpose. Backfilled houses have no landlord on record, and
  -- inventing a name would put a person in the database who does not exist.
  landlord_name  text,
  landlord_phone text,
  landlord_email text,

  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  deactivated_at timestamptz,

  constraint houses_code_not_blank   check (btrim(house_code) <> ''),
  constraint houses_number_not_blank check (btrim(house_number) <> '')
);

-- Unique WITHIN an estate, which is exactly why a resident supplies both codes:
-- H4K2 may exist at several estates, and the pair is what resolves.
create unique index if not exists houses_estate_code_key
  on public.houses (estate_id, house_code);

-- One row per house number per estate, so the same house cannot be created twice.
create unique index if not exists houses_estate_number_key
  on public.houses (estate_id, house_number);

comment on table public.houses is
  'A dwelling within an estate. Carries the landlord as data, not as a user. '
  'house_code is unique per estate and is the second half of a resident join.';

-- ─── memberships point at a house ────────────────────────────────────────────

alter table public.memberships
  add column if not exists house_id uuid references public.houses (id) on delete set null;

create index if not exists memberships_house_idx on public.memberships (house_id);

comment on column public.memberships.unit is
  'DEPRECATED by memberships.house_id. Kept only so the backfill below is '
  'auditable; read houses.house_number instead.';

-- ─── join requests carry the house, resolved from the code ───────────────────

alter table public.join_requests
  add column if not exists house_id uuid references public.houses (id) on delete cascade;

-- ─── backfill ────────────────────────────────────────────────────────────────
--
-- Every existing resident with a unit becomes a house at that number, with no
-- landlord on record. Guards and admins are not attached to a house — they work
-- at the estate, they do not live in it.

do $$
declare
  r record;
  v_house uuid;
begin
  for r in
    select distinct m.estate_id, btrim(m.unit) as unit
      from public.memberships m
     where m.role = 'resident' and m.unit is not null and btrim(m.unit) <> ''
  loop
    insert into public.houses (estate_id, house_number)
    values (r.estate_id, r.unit)
    on conflict (estate_id, house_number) do update set house_number = excluded.house_number
    returning id into v_house;

    update public.memberships
       set house_id = v_house
     where estate_id = r.estate_id and role = 'resident' and btrim(unit) = r.unit;
  end loop;
end $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.houses enable row level security;

-- Admins see every house at their estate; a resident sees only their own, so
-- the app can show "House 14" without exposing the estate's whole register.
create policy "houses: admins read their estate's, residents read their own"
  on public.houses for select to authenticated
  using (
    public.has_membership(estate_id, 'admin')
    or exists (
      select 1 from public.memberships m
       where m.house_id = houses.id
         and m.user_id = (select auth.uid())
         and m.is_active
    )
  );

-- No client write policy. Houses are created and changed through the definer
-- functions below, so a resident cannot rename the house they live in.
grant select on public.houses to authenticated;

-- ─── create_house ────────────────────────────────────────────────────────────

create or replace function public.create_house(
  p_estate_id      uuid,
  p_house_number   text,
  p_landlord_name  text default null,
  p_landlord_phone text default null,
  p_landlord_email text default null
)
returns table (id uuid, house_code text, house_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house  public.houses;
  v_number text := nullif(btrim(p_house_number), '');
  v_try    text;
begin
  if public.current_membership(p_estate_id, 'admin') is null
     and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if v_number is null then
    raise exception 'house_number_required' using errcode = '22023';
  end if;

  -- Retry until the code is free WITHIN this estate. 4 glyphs is a small space
  -- by design, so a collision is ordinary rather than exceptional.
  loop
    v_try := public.generate_code(4);
    exit when not exists (
      select 1 from public.houses h
       where h.estate_id = p_estate_id and h.house_code = v_try
    );
  end loop;

  insert into public.houses (
    estate_id, house_code, house_number, landlord_name, landlord_phone, landlord_email)
  values (
    p_estate_id, v_try, v_number,
    nullif(btrim(p_landlord_name), ''),
    nullif(btrim(p_landlord_phone), ''),
    nullif(btrim(p_landlord_email), ''))
  returning * into v_house;

  return query select v_house.id, v_house.house_code, v_house.house_number;
end;
$$;

-- ─── rotate_house_code ───────────────────────────────────────────────────────

create or replace function public.rotate_house_code(p_house_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_house public.houses;
  v_try   text;
begin
  select * into v_house from public.houses where id = p_house_id;
  if v_house.id is null then
    raise exception 'house_not_found' using errcode = 'P0002';
  end if;

  if public.current_membership(v_house.estate_id, 'admin') is null
     and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  loop
    v_try := public.generate_code(4);
    exit when not exists (
      select 1 from public.houses h
       where h.estate_id = v_house.estate_id and h.house_code = v_try
    );
  end loop;

  update public.houses set house_code = v_try where id = p_house_id;
  return v_try;
end;
$$;

-- ─── request_house_access (replaces request_estate_access) ───────────────────
--
-- The old single-code function is dropped rather than left alongside: two ways
-- to join, one of which cannot place a resident in a house, is exactly the kind
-- of half-migrated state that rots.

drop function if exists public.request_estate_access(text, text);

create or replace function public.request_house_access(
  p_estate_code text,
  p_house_code  text
)
returns table (result text, estate_id uuid, estate_name text, house_id uuid, house_number text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := (select auth.uid());
  v_window  timestamptz := date_trunc('minute', now());
  v_limit   constant integer := 5;
  v_hits    integer;
  v_estate  public.estates;
  v_house   public.houses;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Counted before any decision, and never RAISEd for an expected outcome: an
  -- exception rolls the counter back with the transaction, so the limiter would
  -- only ever count successes (§3.2).
  insert into public.join_attempts (user_id, window_start, hits)
  values (v_user, v_window, 1)
  on conflict (user_id, window_start)
  do update set hits = join_attempts.hits + 1
  returning hits into v_hits;

  if v_hits > v_limit then
    return query select 'rate_limited'::text, null::uuid, null::text, null::uuid, null::text;
    return;
  end if;

  select e.* into v_estate
    from public.estates e
   where e.join_code = upper(regexp_replace(coalesce(p_estate_code, ''), '[^A-Za-z0-9]', '', 'g'));

  if v_estate.id is null then
    return query select 'unknown_estate'::text, null::uuid, null::text, null::uuid, null::text;
    return;
  end if;

  select h.* into v_house
    from public.houses h
   where h.estate_id = v_estate.id
     and h.house_code = upper(regexp_replace(coalesce(p_house_code, ''), '[^A-Za-z0-9]', '', 'g'))
     and h.is_active;

  -- Deliberately distinct from unknown_estate: "your estate code is right but
  -- the house code is not" is a different conversation at the front desk.
  if v_house.id is null then
    return query select 'unknown_house'::text, v_estate.id, v_estate.name, null::uuid, null::text;
    return;
  end if;

  if exists (
    select 1 from public.memberships m
     where m.user_id = v_user and m.estate_id = v_estate.id and m.is_active
  ) then
    return query select 'already_a_member'::text, v_estate.id, v_estate.name,
                        v_house.id, v_house.house_number;
    return;
  end if;

  if exists (
    select 1 from public.join_requests j
     where j.user_id = v_user and j.estate_id = v_estate.id and j.status = 'pending'
  ) then
    return query select 'already_pending'::text, v_estate.id, v_estate.name,
                        v_house.id, v_house.house_number;
    return;
  end if;

  insert into public.join_requests (user_id, estate_id, house_id, requested_unit)
  values (v_user, v_estate.id, v_house.id, v_house.house_number);

  return query select 'ok'::text, v_estate.id, v_estate.name, v_house.id, v_house.house_number;
end;
$$;

-- ─── approve_join_request now places them in the requested house ─────────────
--
-- No p_unit any more: the house came from the code the resident typed, so the
-- admin is confirming a person, not retyping an address.

drop function if exists public.approve_join_request(uuid, text);

create or replace function public.approve_join_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req        public.join_requests;
  v_admin      uuid;
  v_membership uuid;
  v_number     text;
begin
  select * into v_req from public.join_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;

  -- Authority derived from the REQUEST's estate, never a parameter, so an admin
  -- at estate A cannot approve into estate B.
  v_admin := public.current_membership(v_req.estate_id, 'admin');
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'request_already_decided' using errcode = '22023';
  end if;

  select h.house_number into v_number from public.houses h where h.id = v_req.house_id;

  insert into public.memberships (user_id, estate_id, role, house_id, unit)
  values (v_req.user_id, v_req.estate_id, 'resident', v_req.house_id, v_number)
  on conflict (user_id, estate_id, role)
  do update set
    is_active      = true,
    deactivated_at = null,
    house_id       = coalesce(excluded.house_id, memberships.house_id),
    unit           = coalesce(excluded.unit, memberships.unit)
  returning memberships.id into v_membership;

  update public.join_requests
     set status = 'approved', decided_at = now(), decided_by_membership_id = v_admin
   where id = p_request_id;

  return v_membership;
end;
$$;

-- ─── grants ──────────────────────────────────────────────────────────────────

revoke execute on function public.create_house(uuid, text, text, text, text) from public, anon;
revoke execute on function public.rotate_house_code(uuid)                     from public, anon;
revoke execute on function public.request_house_access(text, text)            from public, anon;
revoke execute on function public.approve_join_request(uuid)                  from public, anon;

grant execute on function public.create_house(uuid, text, text, text, text) to authenticated;
grant execute on function public.rotate_house_code(uuid)                    to authenticated;
grant execute on function public.request_house_access(text, text)           to authenticated;
grant execute on function public.approve_join_request(uuid)                 to authenticated;
