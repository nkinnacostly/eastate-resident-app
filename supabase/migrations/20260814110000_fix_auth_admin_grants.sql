-- Estate Access Platform — restore GoTrue's access to the profile trigger
-- Technical Design v2.0 §2.1, §7
--
-- REGRESSION FIX.
--
-- 20260813120700_functions.sql (and again 20260814101000) did:
--
--     revoke execute on function public.handle_new_user() from public, anon, authenticated;
--
-- `handle_new_user` is the AFTER INSERT trigger on auth.users that creates the
-- matching public.profiles row. The role that performs the triggering insert is
-- `supabase_auth_admin` (GoTrue), and it held EXECUTE only via PUBLIC. Revoking
-- PUBLIC therefore took it away, and sign-up/sign-in started failing with:
--
--     500 unexpected_failure / "Database error querying schema"
--
-- which names neither the function nor the privilege, and so is thoroughly
-- unhelpful. It went unnoticed because the earlier manual signup attempts were
-- rejected by the email rate limiter *before* GoTrue reached the database.
--
-- The lesson generalises: revoking PUBLIC is right, but PUBLIC is also how
-- platform-owned roles inherit access to objects in `public`. Anything the
-- platform invokes needs an explicit grant to the role that invokes it.

grant execute on function public.handle_new_user() to supabase_auth_admin;

-- The function is SECURITY DEFINER, so the insert itself runs as the owner and
-- this is not strictly required — granted anyway so the trigger keeps working
-- if it is ever changed to SECURITY INVOKER.
grant usage  on schema public       to supabase_auth_admin;
grant insert on public.profiles     to supabase_auth_admin;
grant select on public.profiles     to supabase_auth_admin;
