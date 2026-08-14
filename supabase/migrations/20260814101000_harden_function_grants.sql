-- Estate Access Platform — function privilege hardening
-- Technical Design v2.0 §2.9
--
-- WHY THIS EXISTS
--
-- Supabase's own advisors flagged every RPC as executable by `anon`. Cause:
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and
-- 20260813120700_functions.sql only ever *added* a grant to `authenticated` —
-- it never removed the implicit one. `grant ... to authenticated` does not
-- narrow access; it widens it.
--
-- Nothing was actually exploitable: each function resolves identity through
-- auth.uid(), so an anon caller got 'not_a_resident' or a 42501. But an
-- unauthenticated caller could still reach /rest/v1/rpc/* and make the database
-- do work, which is a denial-of-service and enumeration surface with no upside.
-- Least privilege belongs at the grant, not only in the function body.

-- ─── Close the PUBLIC default on everything we own ───────────────────────────

revoke execute on function public.mint_access_code(uuid)                       from public, anon;
revoke execute on function public.verify_access_code(uuid, text, uuid)         from public, anon;
revoke execute on function public.ingest_verification_events(uuid, jsonb)      from public, anon;
revoke execute on function public.sync_pull(uuid, bigint)                      from public, anon;
revoke execute on function public.deactivate_membership(uuid)                  from public, anon;
revoke execute on function public.create_estate(text, text, text)              from public, anon;
revoke execute on function public.grant_membership(uuid, uuid, text)           from public, anon;
revoke execute on function public.register_push_token(uuid, text, text, text)  from public, anon;
revoke execute on function public.has_membership(uuid, text)                   from public, anon;
revoke execute on function public.current_membership(uuid, text)               from public, anon;
revoke execute on function public.is_platform_admin()                          from public, anon;

-- Internal machinery: reachable by nobody but the definer chain.
revoke execute on function public._ingest_verification_event(
  uuid, uuid, uuid, uuid, text, timestamptz, public.event_source, integer) from public, anon, authenticated;
revoke execute on function public.generate_code(integer)  from public, anon, authenticated;
revoke execute on function public.sweep_expired_codes()   from public, anon, authenticated;
revoke execute on function public.sweep_mint_attempts()   from public, anon, authenticated;
revoke execute on function public.bump_sync_seq()         from public, anon, authenticated;
revoke execute on function public.handle_new_user()       from public, anon, authenticated;

-- ─── Re-assert the intended surface ──────────────────────────────────────────

grant execute on function public.mint_access_code(uuid)                       to authenticated;
grant execute on function public.verify_access_code(uuid, text, uuid)         to authenticated;
grant execute on function public.ingest_verification_events(uuid, jsonb)      to authenticated;
grant execute on function public.sync_pull(uuid, bigint)                      to authenticated;
grant execute on function public.deactivate_membership(uuid)                  to authenticated;
grant execute on function public.create_estate(text, text, text)              to authenticated;
grant execute on function public.grant_membership(uuid, uuid, text)           to authenticated;
grant execute on function public.register_push_token(uuid, text, text, text)  to authenticated;
grant execute on function public.has_membership(uuid, text)                   to authenticated;
grant execute on function public.current_membership(uuid, text)               to authenticated;
grant execute on function public.is_platform_admin()                          to authenticated;

-- ─── Pin the remaining mutable search paths ──────────────────────────────────
--
-- Both already fully qualify their references, so this changes no behaviour —
-- but generate_code is called from inside a SECURITY DEFINER function, and a
-- function without its own SET search_path inherits the caller's. Making it
-- explicit means that stays true no matter who calls it later.

alter function public.generate_code(integer) set search_path = '';
alter function public.bump_sync_seq()        set search_path = '';

-- ─── Collapse the duplicate SELECT policies on profiles ──────────────────────
--
-- Two permissive policies for the same role and action are OR'd, so both are
-- evaluated on every read. One policy expressing the same rule is equivalent
-- and cheaper.

drop policy if exists "profiles: read own"                         on public.profiles;
drop policy if exists "profiles: admins read their estate's members" on public.profiles;

create policy "profiles: read own, or as an admin of their estate"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships m
       where m.user_id = profiles.id
         and m.is_active
         and public.has_membership(m.estate_id, 'admin')
    )
  );
