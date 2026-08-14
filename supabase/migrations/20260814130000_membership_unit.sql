-- Unit number on the membership, not the profile.
--
-- A unit is a property of a RESIDENCY, not of a person: the same human can hold
-- memberships at two estates with different units, and move-out (deactivate the
-- membership) has to take the unit with it. Hanging it off `profiles` would
-- outlive the residency and leak one estate's unit into another's admin view.
--
-- Until now the sign-up form's unit went only into `auth.users.user_metadata`,
-- which an estate admin cannot query, filter, or sort — which is the entire
-- point of a unit number.

alter table public.memberships
  add column if not exists unit text;

comment on column public.memberships.unit is
  'Unit/house identifier within the estate, e.g. "B12". Set by an estate admin '
  'when granting membership. Free text: estates number their units in wildly '
  'different schemes, so validation belongs in the admin UI, not a CHECK.';

-- Never store '' — an empty string reads as "unit known to be blank" whereas
-- NULL is "not set". The distinction matters to the admin dashboard.
alter table public.memberships
  drop constraint if exists memberships_unit_not_blank;
alter table public.memberships
  add constraint memberships_unit_not_blank
  check (unit is null or btrim(unit) <> '');

-- The admin dashboard lists residents by estate and looks them up by unit.
create index if not exists memberships_estate_unit_idx
  on public.memberships (estate_id, unit)
  where unit is not null;

-- ---------------------------------------------------------------------------
-- grant_membership gains p_unit.
--
-- The old 3-arg function MUST be dropped, not left alongside. Adding a 4th
-- parameter with a default does not replace it — Postgres would then see
-- grant_membership(uuid, uuid, text) as ambiguous between the two candidates
-- and fail every existing call with 42725 "function is not unique".
-- ---------------------------------------------------------------------------

drop function if exists public.grant_membership(uuid, uuid, text);

create function public.grant_membership(
  p_estate_id uuid,
  p_user_id   uuid,
  p_role      text,
  p_unit      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_unit          text := nullif(btrim(p_unit), '');
begin
  -- an estate admin manages their own estate; the platform owner seeds the
  -- first admin, when no estate admin exists yet
  if public.current_membership(p_estate_id, 'admin') is null
     and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  insert into public.memberships (user_id, estate_id, role, unit)
  values (p_user_id, p_estate_id, p_role::public.membership_role, v_unit)
  on conflict (user_id, estate_id, role)
  do update set
    is_active      = true,
    deactivated_at = null,
    -- Re-granting without a unit must not wipe one already on file; passing a
    -- unit updates it. coalesce on the EXCLUDED value gives both.
    unit           = coalesce(excluded.unit, memberships.unit)
  returning memberships.id into v_membership_id;

  return v_membership_id;
end;
$$;

-- Functions are EXECUTE-to-PUBLIC by default, so a fresh signature is
-- anon-callable until explicitly revoked. The drop above took the old grants
-- with it — these are not inherited.
revoke execute on function public.grant_membership(uuid, uuid, text, text) from public, anon;
grant  execute on function public.grant_membership(uuid, uuid, text, text) to authenticated;
