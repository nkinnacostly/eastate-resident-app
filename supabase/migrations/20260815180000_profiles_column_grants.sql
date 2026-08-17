-- Make must_change_password actually unwritable by its owner.
--
-- The previous migration did `revoke update (must_change_password) ... from
-- authenticated` and that revoke does NOTHING, because a table-level
-- `grant update on public.profiles` was already in force (20260814100000) and
-- table-wide UPDATE covers every column, including ones added later. Postgres
-- does not subtract a column-level revoke from a table-level grant — the
-- broader grant simply still applies.
--
-- Caught by the onboarding test, which tried to clear the flag as the new admin
-- and succeeded. The fix is to drop to column-level grants: with no table-level
-- UPDATE, a statement may only touch columns explicitly granted.
--
-- This also means any column added to profiles in future is unwritable by
-- clients until someone grants it deliberately, which is the right default for
-- a table the RLS policy lets people update their own row of.

revoke update on public.profiles from authenticated;

-- The two fields a person may maintain about themselves. `id` is the identity,
-- `created_at` is a fact, `must_change_password` is the platform's to clear —
-- via clear_must_change_password(), after the password has actually changed.
grant update (phone, full_name) on public.profiles to authenticated;
