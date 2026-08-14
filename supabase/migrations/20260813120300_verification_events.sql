-- Estate Access Platform — verification events (append-only audit log)
-- Technical Design v2.0 §2.5

create table public.verification_events (
  -- Server-generated. The client's id lives in client_event_id below.
  id                        uuid primary key default gen_random_uuid(),

  -- Generated on-device so an event keeps a stable identity across retries.
  -- It is NOT the primary key: a device that emitted a uuid already present in
  -- the table would have its event silently swallowed as a duplicate — by a
  -- broken RNG, or deliberately by a hostile client suppressing another
  -- estate's audit record.
  client_event_id           uuid not null,

  -- Denormalised so a rejection that never resolved to a code still has a
  -- tenant. RLS scopes this table on estate_id, and code_id is nullable, so
  -- deriving the estate through the code would leave unknown-code rejections
  -- unreachable by any policy.
  estate_id                 uuid not null references public.estates (id) on delete cascade,

  -- Null when the typed string did not resolve to a known code.
  code_id                   uuid references public.access_codes (id),

  verified_by_membership_id uuid not null references public.memberships (id),

  -- Device clock: what the guard saw. Displayed to humans, NEVER used for
  -- ordering — phone clocks drift by minutes and one device set to the wrong
  -- year would poison ordering permanently (§10).
  verified_at               timestamptz not null,
  -- Server clock: what the system orders and reconciles by.
  synced_at                 timestamptz not null default now(),

  source                    public.event_source not null,
  outcome                   public.event_outcome not null default 'pending',
  reject_reason             public.reject_reason,
  collision                 boolean not null default false,

  -- How stale the guard's local pool was at verification time (§5.2), so the
  -- admin log can read "verified against a 40-minute-old pool".
  pool_age_seconds          integer,

  -- THE dedupe key (§5.3). Scoped to the membership so a client's uniqueness
  -- claim never spans another tenant's rows.
  constraint verification_events_dedupe_key
    unique (verified_by_membership_id, client_event_id)
);

-- The estate admin's entry log, newest first.
create index verification_events_estate_idx
  on public.verification_events (estate_id, synced_at desc);

-- Collision and rejection review queues.
create index verification_events_collision_idx
  on public.verification_events (estate_id, synced_at desc)
  where collision;

create index verification_events_rejected_idx
  on public.verification_events (estate_id, synced_at desc)
  where outcome = 'rejected';

create index verification_events_code_idx
  on public.verification_events (code_id);
