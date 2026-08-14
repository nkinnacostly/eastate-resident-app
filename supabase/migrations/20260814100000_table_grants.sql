-- Estate Access Platform — explicit table grants
-- Technical Design v2.0 §2.9
--
-- WHY THIS EXISTS
--
-- 20260813120600_rls.sql created SELECT policies and assumed the underlying
-- table privileges were already there. They were not: `authenticated` held only
-- REFERENCES/TRIGGER/TRUNCATE, so every read failed with
--
--     42501: permission denied for table access_codes
--
-- before RLS was ever consulted. Postgres checks GRANTs FIRST and only then
-- filters rows with policies. A policy without a grant is a dead letter — it
-- looks like security, and it is actually a broken read path.
--
-- So: grant explicitly rather than relying on the platform's defaults, which
-- depend on which role ran the migration.
--
-- The write side stays revoked. access_codes and verification_events remain
-- SELECT-only for clients; the sole write path is a SECURITY DEFINER function,
-- which runs as owner and is unaffected by any of this (§1).

-- ─── Reads ────────────────────────────────────────────────────────────────────

grant select on public.profiles            to authenticated;
grant select on public.estates             to authenticated;
grant select on public.memberships         to authenticated;
grant select on public.platform_admins     to authenticated;
grant select on public.access_codes        to authenticated;
grant select on public.verification_events to authenticated;

-- ─── Writes: only where a policy actually permits one ─────────────────────────

-- profiles has an "update own" policy (§2.9)
grant update on public.profiles to authenticated;

-- push_tokens has a FOR ALL policy — devices manage their own tokens directly
grant select, insert, update, delete on public.push_tokens to authenticated;

-- ─── Belt and braces ──────────────────────────────────────────────────────────

-- Re-assert what must never be client-writable, in case a default privilege
-- or a future migration re-grants it.
revoke insert, update, delete on public.access_codes        from anon, authenticated;
revoke insert, update, delete on public.verification_events from anon, authenticated;
revoke insert, update, delete on public.estates             from anon, authenticated;
revoke insert, update, delete on public.memberships         from anon, authenticated;
revoke insert, update, delete on public.platform_admins     from anon, authenticated;

-- The rate limiter's state is nobody's business but the definer functions'.
revoke all on public.code_mint_attempts from anon, authenticated;

-- anon has no business anywhere in this schema.
revoke all on all tables in schema public from anon;
