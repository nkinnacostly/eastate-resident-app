-- Estate Access Platform — access codes
-- Technical Design v2.0 §2.4

-- Server-owned monotonic cursor for sync_pull (§5.2). MUST be an integer
-- sequence, not a timestamp: timestamps tie, go backwards under clock
-- correction, and cannot be trusted from clients.
create sequence public.access_codes_sync_seq;

create table public.access_codes (
  id                        uuid primary key default gen_random_uuid(),
  code                      text not null,
  estate_id                 uuid not null references public.estates (id) on delete cascade,
  membership_id             uuid not null references public.memberships (id) on delete cascade,
  status                    public.code_status not null default 'active',
  created_at                timestamptz not null default now(),
  expires_at                timestamptz not null,
  used_at                   timestamptz,
  verified_by_membership_id uuid references public.memberships (id),
  revoked_at                timestamptz,
  revoked_by_membership_id  uuid references public.memberships (id),
  revoked_reason            public.revoked_reason,

  -- Set by the janitor on long-dead rows purely to release the code string
  -- back into circulation. Carries NO meaning about whether the code was
  -- usable — that is always (status, expires_at). See the janitor below.
  swept_at                  timestamptz,

  sync_seq                  bigint not null default nextval('public.access_codes_sync_seq')
);

-- ─── sync_seq maintenance ─────────────────────────────────────────────────────
-- Bump on every real mutation so the change is picked up by the next pull.
-- The WHEN guard keeps no-op updates from advancing the cursor for nothing.

create function public.bump_sync_seq()
returns trigger
language plpgsql
as $$
begin
  new.sync_seq := nextval('public.access_codes_sync_seq');
  return new;
end;
$$;

create trigger access_codes_bump_sync_seq
  before update on public.access_codes
  for each row
  when (old.* is distinct from new.*)
  execute function public.bump_sync_seq();

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index access_codes_pool_idx
  on public.access_codes (estate_id, status, expires_at);

create index access_codes_membership_idx
  on public.access_codes (membership_id, status, expires_at);

create index access_codes_sync_idx
  on public.access_codes (estate_id, sync_seq);

-- An estate cannot have two live codes with the same string at the same time.
--
-- This CANNOT include `expires_at > now()`: Postgres requires index predicates
-- to be IMMUTABLE and now() is not. `swept_at is null` is the immutable stand-in
-- — it lets the janitor release strings without the predicate depending on the
-- clock. Until a row is swept it keeps holding its string, so uniqueness is
-- slightly conservative. Harmless against a ~887M space with a 6-hour window.
create unique index access_codes_live_code_key
  on public.access_codes (estate_id, code)
  where status = 'active' and swept_at is null;

-- ─── Janitor (cosmetic only) ──────────────────────────────────────────────────
-- Releases code strings from long-dead rows and shrinks the guard's pull.
--
-- It does NOT expire anything. Expiry is derived from expires_at and is checked
-- directly in every verification path, so this job stopping is a housekeeping
-- lapse, not a security hole. Never make it the mechanism by which codes stop
-- working, and never write `status = 'expired'` — that value does not exist,
-- deliberately (§2.4). Marking a timed-out code as 'revoked' would be just as
-- wrong: the audit trail must distinguish "aged out" from "an admin cut you off".

create function public.sweep_expired_codes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.access_codes
     set swept_at = now()
   where status = 'active'
     and swept_at is null
     and expires_at <= now() - interval '1 hour';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.sweep_expired_codes is
  'Cosmetic housekeeping only (Technical Design §2.4): releases code strings held '
  'by long-expired rows. Expiry itself is enforced by expires_at checks in the '
  'verification path, never here. Late tombstones this emits are harmless and '
  'must not be depended on.';
