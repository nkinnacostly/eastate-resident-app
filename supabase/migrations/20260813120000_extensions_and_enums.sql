-- Estate Access Platform — extensions and enum types
-- Technical Design v2.0 §2
--
-- Run order matters: every later migration depends on these types.

-- pgcrypto gives us gen_random_bytes() for code generation (§3).
-- gen_random_uuid() is core Postgres since 13 and needs no extension.
create extension if not exists pgcrypto with schema extensions;

-- ─── Enums ────────────────────────────────────────────────────────────────────

create type public.membership_role as enum ('resident', 'guard', 'admin');

-- NOTE: there is deliberately no 'expired' status (§2.4). Expiry is derived
-- from expires_at, which every query already checks. Storing it too would mean
-- two sources of truth for one fact and would make correctness depend on a
-- sweeper job having run recently.
create type public.code_status as enum ('active', 'used', 'revoked');

create type public.revoked_reason as enum (
  'membership_deactivated',
  'admin_revoked',
  'resident_cancelled'
);

create type public.event_source as enum ('online', 'offline_replay');

create type public.event_outcome as enum (
  'pending',    -- claimed, burn not yet attempted (transient within the txn)
  'admitted',
  'collision',  -- tried to burn a code a DIFFERENT event already burned
  'rejected'
);

create type public.reject_reason as enum (
  'unknown_code',
  'expired',
  'already_used',
  'revoked'
);
