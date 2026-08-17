-- Let PostgREST embed a profile from a membership or a join request.
--
-- `memberships.user_id` and `profiles.id` BOTH reference auth.users(id), which
-- means they are related through auth.users but not to each other. PostgREST
-- builds embeds from foreign keys, so
--
--     .select('id, unit, profiles(full_name, phone)')
--
-- failed with "could not find the relation between memberships and profiles" —
-- the admin dashboard could list memberships or names, never both in one query.
--
-- Adding a second FK straight to profiles is the standard fix. It is sound
-- because profiles is keyed 1:1 to auth.users: any id valid for one is valid for
-- the other, so this constrains nothing new. Verified before adding — zero rows
-- in either table reference a user without a profile.
--
-- ON DELETE CASCADE matches the existing auth.users FK, so deleting a user still
-- removes their memberships rather than erroring on this constraint first.

alter table public.memberships
  drop constraint if exists memberships_user_id_profiles_fkey;
alter table public.memberships
  add constraint memberships_user_id_profiles_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.join_requests
  drop constraint if exists join_requests_user_id_profiles_fkey;
alter table public.join_requests
  add constraint join_requests_user_id_profiles_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- The audit log joins access_codes -> memberships to name the HOST. There are
-- three FKs between those tables (membership_id, verified_by_membership_id,
-- revoked_by_membership_id), so every embed must name the column explicitly —
-- PostgREST refuses to guess. Nothing to change here; this comment records why
-- the client uses `memberships!access_codes_membership_id_fkey(...)`.
comment on constraint access_codes_membership_id_fkey on public.access_codes is
  'The resident who ISSUED the code. Disambiguates the embed from '
  'verified_by_membership_id and revoked_by_membership_id.';
