-- Estate Access Platform — clear the remaining advisor warnings
--
-- Pre-existing, found while checking my own work rather than looked for, and
-- all three are the same two mistakes this repo has made before.
--
-- ─── 1. Two more trigger functions open to anon ──────────────────────────────
--
-- Identical to stamp_agency and stamp_shift_agency in 20260926150000: both are
-- SECURITY DEFINER, both were written as triggers, and neither had EXECUTE
-- revoked. Postgres grants it to PUBLIC on every new function whatever the
-- return type, so both have been callable over the Data API by an
-- unauthenticated client since the day they shipped.
--
-- Same reasoning as before on severity: neither is exploitable as written,
-- because Postgres refuses to invoke a `returns trigger` or `returns
-- event_trigger` function outside its trigger context. But that is the return
-- type protecting them, not the permission, and the permission is what is
-- wrong.
--
-- Revoking cannot affect either trigger. A trigger runs as part of the firing
-- statement under the table owner's rights and never consults the calling
-- role's EXECUTE privilege.

revoke execute on function public.enqueue_landlord_welcome()
  from public, anon, authenticated;

revoke execute on function public.rls_auto_enable()
  from public, anon, authenticated;

-- ─── 2. generate_code had no pinned search_path ──────────────────────────────
--
-- It is SECURITY INVOKER, so the locked rule -- every SECURITY DEFINER function
-- sets search_path = '' -- does not strictly reach it, and anon cannot execute
-- it. Low severity, which is presumably why it survived this long.
--
-- Pinned anyway, because it costs nothing and this function mints the code that
-- the entire product depends on being unguessable. A function whose name
-- resolution depends on the caller's search_path is one refactor away from
-- resolving something it did not mean to.
--
-- Safe to pin: the body already fully qualifies extensions.gen_random_bytes,
-- and substr / get_byte live in pg_catalog, which stays implicitly resolvable
-- under an empty search_path. ALTER FUNCTION rather than CREATE OR REPLACE so
-- the body is not restated here and cannot drift from its own migration.

alter function public.generate_code(integer) set search_path = '';

-- ─── Left alone, deliberately ────────────────────────────────────────────────
--
-- multiple_permissive_policies on public.profiles: two permissive SELECT
-- policies for `authenticated` are evaluated per row, which is a performance
-- warning, not a hole. Merging them changes an existing security boundary on
-- the table that holds every user's name and phone number, and that deserves
-- its own change with its own tests rather than riding along here.
--
-- extension_in_public for pg_net and btree_gist: Supabase prefers extensions in
-- their own schema. pg_net was already in public, so btree_gist matches the
-- house pattern. Moving btree_gist would also mean re-resolving the operator
-- class behind agency_contracts_no_overlap -- real risk, no security gain.
--
-- auth_leaked_password_protection: a dashboard setting, not schema. Worth
-- turning on in Auth settings; it cannot be done from a migration.
