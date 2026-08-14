-- Estate Access Platform — service_role privileges
-- Technical Design v2.0 §2.9, §6.3
--
-- Third instance of the same root cause: this project's tables were created by
-- a migration role whose default privileges do not match the platform's, so
-- NONE of anon / authenticated / service_role inherited the grants Supabase
-- projects normally start with. `authenticated` was fixed in
-- 20260814100000_table_grants.sql; this is the server-side half.
--
-- Without it:
--   * the dispatch-notifications Edge Function (§6.3) cannot read push_tokens
--     or drain the queue — notifications and the §5.4 forced pull both die
--     silently at build step 6;
--   * admin/seed tooling using the service key fails with 42501.
--
-- service_role is the trusted server identity: it carries BYPASSRLS, so
-- policies never constrain it and the grants below are what actually govern it.
-- It must NEVER be shipped to a client (§11).

grant usage on schema public to service_role;

grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- Future objects, so a later migration does not silently reintroduce this bug.
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant all privileges on functions to service_role;

-- The notification queue is drained by the Edge Function running as service_role.
grant usage on schema pgmq to service_role;
grant all privileges on all tables in schema pgmq to service_role;
grant all privileges on all functions in schema pgmq to service_role;

-- Re-assert that the untrusted roles gained nothing from the blanket grants above.
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.access_codes        from anon, authenticated;
revoke insert, update, delete on public.verification_events from anon, authenticated;
revoke all on public.code_mint_attempts from anon, authenticated;
