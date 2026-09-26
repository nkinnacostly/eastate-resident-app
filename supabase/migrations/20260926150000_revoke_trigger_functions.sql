-- Estate Access Platform — close the trigger functions to callers
--
-- `npm run db:advisors` after the agency migrations flagged stamp_agency and
-- stamp_shift_agency under anon_security_definer_function_executable: both are
-- SECURITY DEFINER and neither had its EXECUTE revoked, so both were callable
-- over the Data API by an unauthenticated client.
--
-- I wrote them thinking "trigger", and revoked nothing because a trigger is not
-- an RPC. Postgres does not agree: EXECUTE is granted to PUBLIC on every new
-- function regardless of what it returns, and being attached to a trigger does
-- not remove it from the API surface. This repo has shipped that exact bug
-- before, which is why the rule is in CLAUDE.md.
--
-- Not exploitable as written -- Postgres refuses to run a `returns trigger`
-- function outside a trigger context (0A000) -- but that is a property of the
-- return type, not of the permissions, and it would silently stop protecting
-- anything the day either function's signature changed. The grant is the thing
-- that was wrong, so the grant is what gets fixed.
--
-- Revoking does not affect the triggers. A trigger executes as part of the
-- statement that fired it, under the table owner's rights, and never consults
-- the calling role's EXECUTE privilege on the trigger function.

revoke execute on function public.stamp_agency() from public, anon, authenticated;
revoke execute on function public.stamp_shift_agency() from public, anon, authenticated;

-- Same reasoning one step further out. is_agency_admin is a helper for the
-- definer functions that enforce agency authority; a SECURITY DEFINER caller
-- runs as the owner, so the invoking role needs no EXECUTE of its own. No RLS
-- policy references it either -- the agency policies go through
-- private.caller_agency_ids(). The client never needs it: the portal learns its
-- role from my_agencies(), which returns it.
--
-- It leaks nothing on its own (a caller can only ask about themselves), so this
-- is surface reduction rather than a fix. But an authority predicate that is
-- publicly callable is the kind of thing that ends up load-bearing somewhere it
-- should not be.
revoke execute on function public.is_agency_admin(uuid) from public, anon, authenticated;
