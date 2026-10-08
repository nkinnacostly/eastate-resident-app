-- Guard invitations: an existing account joins an estate's gate only by
-- accepting.
--
-- onboard-guard used to look an email up and, finding an account, attach it
-- as a guard on the spot. Any estate admin could therefore pull any person on
-- the platform into their estate without asking them — and becoming a member
-- is what opens a person's profile (name, phone, email, last sign-in) to that
-- estate's admins. A membership is now created for an existing account only
-- when its owner accepts, signed in as themselves, in the guard app.
--
-- Brand-new accounts are unchanged: onboard-guard creates them and hands the
-- password over in person. Nobody's consent is being skipped there; the
-- account did not exist until the admin made it, and it is flagged
-- email_unproven (see 20261008120000) so it carries no identity beyond that.

create table public.guard_invites (
  id                       uuid primary key default gen_random_uuid(),
  estate_id                uuid not null references public.estates (id) on delete cascade,
  user_id                  uuid not null references auth.users (id) on delete cascade,
  invited_by_membership_id uuid references public.memberships (id) on delete set null,
  status                   text not null default 'pending'
                           check (status in ('pending', 'accepted', 'declined')),
  created_at               timestamptz not null default now(),
  responded_at             timestamptz
);

-- One open invitation per person per estate: inviting twice re-sends, it does
-- not stack up rows to accept.
create unique index guard_invites_one_pending
  on public.guard_invites (estate_id, user_id) where status = 'pending';

-- Definer functions only. No client reads the table: an admin who could list
-- invites would read back the user id of every address they tried, which is
-- the "does this person have an account" answer this table exists to stop
-- handing out.
alter table public.guard_invites enable row level security;
revoke all on public.guard_invites from anon, authenticated;

-- ─── The invitee's side ──────────────────────────────────────────────────────

create function public.my_guard_invites()
returns table (invite_id uuid, estate_id uuid, estate_name text, invited_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.estate_id, e.name, i.created_at
    from public.guard_invites i
    join public.estates e on e.id = i.estate_id and e.is_active
   where i.user_id = (select auth.uid())
     and i.status = 'pending'
   order by i.created_at;
$$;
revoke execute on function public.my_guard_invites() from public, anon;
grant  execute on function public.my_guard_invites() to authenticated;

create function public.respond_to_guard_invite(p_invite_id uuid, p_accept boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invite public.guard_invites;
begin
  -- Identity from the session, never a parameter: the invite id alone must not
  -- let anyone accept on someone else's behalf. Someone else's invite answers
  -- exactly like a missing one.
  select * into v_invite
    from public.guard_invites
   where id = p_invite_id
     and user_id = (select auth.uid())
     and status = 'pending'
   for update;

  if v_invite.id is null then
    return 'not_found';
  end if;

  if p_accept then
    insert into public.memberships (user_id, estate_id, role)
    values (v_invite.user_id, v_invite.estate_id, 'guard')
    on conflict (user_id, estate_id, role)
    do update set is_active = true, deactivated_at = null;
  end if;

  update public.guard_invites
     set status       = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = v_invite.id;

  return case when p_accept then 'accepted' else 'declined' end;
end;
$$;
revoke execute on function public.respond_to_guard_invite(uuid, boolean) from public, anon;
grant  execute on function public.respond_to_guard_invite(uuid, boolean) to authenticated;

-- ─── grant_membership: no more pulling strangers in ─────────────────────────
--
-- The same hole one level down. grant_membership took any p_user_id from any
-- estate admin, so an admin holding a user's id could attach them directly,
-- in any role, without onboard-guard at all. Now:
--
--   * the service role (onboard-guard, for an account it has just created and
--     after checking the caller administers the estate) — allowed;
--   * a platform operator (onboard-estate seeding an estate's first admin) —
--     allowed, as before;
--   * an estate admin — only for someone who ALREADY has a membership at this
--     estate, in any role, active or not: changing a member's role or
--     bringing a former member back. Everyone else comes in by accepting.
create or replace function public.grant_membership(
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
  v_service       boolean := coalesce((select auth.jwt()) ->> 'role', '') = 'service_role';
begin
  if not v_service and not public.is_platform_admin() then
    if public.current_membership(p_estate_id, 'admin') is null then
      raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.memberships m
       where m.user_id = p_user_id and m.estate_id = p_estate_id
    ) then
      raise exception 'not_a_member_of_this_estate' using errcode = '42501';
    end if;
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
