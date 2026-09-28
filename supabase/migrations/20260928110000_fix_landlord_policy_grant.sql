-- Estate Access Platform — an RLS policy can only call what the ROLE may call
--
-- 20260928100000 added a policy letting a landlord read the estates they own
-- property in. The policy calls current_verified_email(), and that function was
-- revoked from `authenticated` on the reasoning that only the server should
-- resolve an identity.
--
-- A POLICY IS EVALUATED AS THE CALLING ROLE. So every authenticated read of
-- `estates` began failing with 42501 -- not just a landlord's. The estate
-- dashboard could not load an estate, and the guard app's shift lookup, which
-- embeds `estates(name)`, broke with it. One policy on one shared table took
-- down two surfaces that have nothing to do with landlords.
--
-- Caught by scripts/test-client-queries.mjs within minutes of deploying,
-- because it runs the apps' real queries as a real signed-in user. Nothing
-- that reads only the schema would have seen it: the policy is valid SQL, the
-- function exists, and the grant list looks deliberate.
--
-- ─── Why granting is the right fix, not loosening the policy ────────────────
--
-- current_verified_email() returns the caller's OWN confirmed address and
-- nothing else. It takes no argument, so there is no other identity to ask
-- about, and the answer is something the caller already knows -- they signed
-- in with it. Revoking it protected nothing; it only made the function unusable
-- in the one place RLS needs it.
--
-- The general rule, worth stating because this repo has now hit both halves of
-- it: a SECURITY DEFINER function used by a POLICY must be executable by the
-- role the policy applies to, while one used as an RPC should be revoked from
-- everyone who has no business calling it directly. Those are different
-- questions and the same function can need both answers.

grant execute on function public.current_verified_email() to authenticated;

comment on function public.current_verified_email is
  'The caller''s own CONFIRMED email, or null. Granted to `authenticated` '
  'because the estates RLS policy calls it and a policy runs as the calling '
  'role -- revoking it made every authenticated read of `estates` fail 42501.';
