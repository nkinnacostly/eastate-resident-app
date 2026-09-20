-- Estate Access Platform — guard onboarding
--
-- Until now the guards page could only list guards. Every guard account had to
-- be made by the platform owner, so an estate that hired someone on a Friday
-- waited on us to put them on the gate. This closes that: an estate admin
-- registers their own guards, the same way they already add houses.
--
-- Almost nothing new is needed in the database. `grant_membership` has always
-- allowed an estate admin to grant a role at their OWN estate (it checks
-- current_membership(p_estate_id, 'admin') and raises 42501 otherwise), and
-- guard_shifts already answers "who is on the gate". The only missing piece is
-- resolving an email address to an existing account, which is why this file
-- holds one function and nothing else.

-- ─── service_find_user_by_email ──────────────────────────────────────────────
--
-- One person can guard more than one estate, and a guard may already have a
-- resident account at the estate where they work. Onboarding therefore has to
-- find an existing account rather than fail on "email already registered".
--
-- WHY THIS IS NOT GRANTED TO `authenticated`, UNLIKE ITS OPERATOR TWIN
--
-- operator_find_user_by_email answers "does this address have an account",
-- which its own comment calls a question not everyone may ask — and it is
-- gated on is_platform_admin() for exactly that reason. Granting an estate
-- admin the same power would hand every one of them an account-enumeration
-- oracle over the whole platform: paste any address, learn whether that person
-- has an account here. There are many estate admins and we do not vet them.
--
-- So this is granted to service_role ONLY. The onboard-guard Edge Function
-- holds the service role key and calls it on the admin's behalf, after it has
-- checked that the caller really does administer the estate in question. The
-- admin never gets to ask the question directly, only to onboard a guard and
-- be told afterwards whether the account already existed — which is a fact
-- about a person they are actively hiring, not about a stranger.
--
-- EXECUTE is granted to PUBLIC by default (see CLAUDE.md), so the revoke below
-- is what makes "service_role only" true rather than merely intended.

create or replace function public.service_find_user_by_email(p_email text)
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, p.full_name
    from auth.users u
    left join public.profiles p on p.id = u.id
   where lower(u.email) = lower(btrim(p_email));
$$;

comment on function public.service_find_user_by_email(text) is
  'Resolve an email to an account. service_role only — an estate admin must not be able to enumerate platform accounts.';

revoke execute on function public.service_find_user_by_email(text) from public, anon, authenticated;
grant  execute on function public.service_find_user_by_email(text) to service_role;
