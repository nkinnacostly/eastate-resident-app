-- Estate Access Platform — push tokens and the rate-limit counter
-- Technical Design v2.0 §2.6, §2.8

-- ─── 2.6 push_tokens ──────────────────────────────────────────────────────────
-- Scoped to MEMBERSHIP, not user: a person who is a resident at one estate and
-- a guard at another must receive each estate's notifications in the right
-- context, and membership scoping keeps tenant isolation intact on the
-- notification path too.

create table public.push_tokens (
  id              uuid primary key default gen_random_uuid(),
  membership_id   uuid not null references public.memberships (id) on delete cascade,
  expo_push_token text not null,
  device_id       text,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),

  constraint push_tokens_membership_token_key unique (membership_id, expo_push_token)
);

create index push_tokens_membership_idx on public.push_tokens (membership_id);

-- ─── 2.8 code_mint_attempts ───────────────────────────────────────────────────
-- Rate-limit counter for mint_access_code (§3.2). One row per membership per
-- minute-window.
--
-- The counter is incremented BEFORE the cap check and is not undone by it —
-- see mint_access_code(), which returns a status row rather than raising for
-- exactly this reason. A limiter that only counts successful mints cannot
-- restrain the abuse it exists to restrain.

create table public.code_mint_attempts (
  membership_id uuid not null references public.memberships (id) on delete cascade,
  window_start  timestamptz not null,
  hits          integer not null default 0,

  primary key (membership_id, window_start)
);

-- Unlike the §2.4 janitor, this one is genuinely disposable.
create function public.sweep_mint_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.code_mint_attempts
   where window_start < now() - interval '1 hour';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
