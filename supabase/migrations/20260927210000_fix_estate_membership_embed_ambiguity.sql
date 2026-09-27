-- Estate Access Platform — un-break login in all three apps
--
-- ─── What happened ──────────────────────────────────────────────────────────
--
-- 20260927130000 added `estates.dues_enforcement_authorised_by` as a foreign
-- key to `memberships(id)`. `memberships.estate_id` already pointed the other
-- way, so from that moment there were TWO relationships between `memberships`
-- and `estates`.
--
-- PostgREST resolves an embed like `estates(name)` by finding THE foreign key
-- between the two tables. With two, it cannot choose, and it does not guess --
-- it answers `HTTP 300 PGRST201` and refuses. Every client in this repo embeds
-- exactly that way at startup:
--
--   apps/web/src/lib/auth.tsx:51      estates(name, join_code)
--   apps/resident/lib/auth.tsx:239    estates(name)
--   apps/guard/lib/shift.tsx:134      estates(name)
--
-- So adding one audit column logged every user out of every surface: the admin
-- dashboard, the resident app and the guard app all failed the same query at
-- login. Worse than an error screen -- each of those call sites deliberately
-- does NOT set its `loaded` flag on failure, on the reasoning that a failed
-- lookup is not proof the person has no estate. That is right for a network
-- blip and wrong for a permanent error: the app waits forever and the user
-- sees a blank screen with nothing to react to.
--
-- ─── Why the fix is here and not only in the clients ────────────────────────
--
-- The queries could each name the constraint -- `estates!memberships_estate_id_
-- fkey(name)` -- and they now do. But a client-side fix only reaches a phone
-- when its owner takes an update. Removing the ambiguity in the database
-- repairs every copy of both mobile apps that is ALREADY INSTALLED, and the
-- already-deployed dashboard, the moment this migration lands. For a bug that
-- makes the product unopenable, that difference is the whole thing.
--
-- ─── Why auth.users and not simply dropping the key ─────────────────────────
--
-- Dropping the foreign key would also remove the ambiguity, at the cost of
-- letting the column hold a membership id that no longer exists -- and this is
-- an audit column, where a dangling reference is precisely the thing that
-- makes it worthless later.
--
-- Pointing it at `auth.users` keeps referential integrity and ends the
-- ambiguity, because `estates` has no other relationship to `auth.users`.
-- `auth` is not an exposed schema, so it can never become an ambiguous embed
-- the way `memberships` did.
--
-- It is also the better record. The question this column answers is "which
-- person authorised withholding access over arrears", and a person outlives
-- the membership row -- a committee member who moves out has their membership
-- deactivated, and the authority they gave should not decay into a dangling
-- id. ON DELETE SET NULL rather than CASCADE for the same reason: deleting an
-- account must not silently delete an estate's record of its own decision.
--
-- Safe to convert in place: verified against production before writing this --
-- 0 of 2 estates had the column set, so there is no data to migrate.

-- The check constraint depends on the column staying not-null-when-authorised,
-- which is unchanged. Only the target of the key moves.
alter table public.estates
  drop constraint estates_dues_enforcement_authorised_by_fkey;

alter table public.estates
  add constraint estates_dues_enforcement_authorised_by_fkey
  foreign key (dues_enforcement_authorised_by)
  references auth.users (id) on delete set null;

comment on column public.estates.dues_enforcement_authorised_by is
  'The PERSON who recorded authority to withhold codes for arrears, not their '
  'membership. Deliberately auth.users: a membership is deactivated on move-out '
  'and an estate''s record of its own decision must not decay with it. Keeping '
  'this off memberships also stops it re-creating the PostgREST embed ambiguity '
  'that broke login in all three apps -- see this migration''s header.';

-- ─── The writer now records the person ───────────────────────────────────────

create or replace function public.set_dues_enforcement(
  p_estate_id  uuid,
  p_authorised boolean,
  p_basis      text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.current_membership(p_estate_id, 'admin');
begin
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if p_authorised then
    -- A basis is required, and blank space is not a basis. This is the record
    -- an estate would produce if a resident challenged being locked out, so
    -- "yes we were allowed to" with nothing after it is not good enough.
    if btrim(coalesce(p_basis, '')) = '' then
      raise exception 'enforcement_basis_required' using errcode = '22023';
    end if;

    update public.estates
       set dues_enforcement_authorised_at = now(),
           -- The person, via auth.uid(), not the membership. Still derived
           -- from the verified JWT and never from an argument.
           dues_enforcement_authorised_by = (select auth.uid()),
           dues_enforcement_basis         = btrim(p_basis)
     where id = p_estate_id;
  else
    -- Withdrawing clears the basis too. Leaving last year's justification
    -- behind on an estate that no longer enforces would misrepresent it the
    -- next time anyone read the row.
    update public.estates
       set dues_enforcement_authorised_at = null,
           dues_enforcement_authorised_by = null,
           dues_enforcement_basis         = null
     where id = p_estate_id;
  end if;

  if not found then
    raise exception 'no_such_estate' using errcode = '42704';
  end if;
end;
$$;

revoke execute on function public.set_dues_enforcement(uuid, boolean, text) from public, anon;
grant  execute on function public.set_dues_enforcement(uuid, boolean, text) to authenticated;
