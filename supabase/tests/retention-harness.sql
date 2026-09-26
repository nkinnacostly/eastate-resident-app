-- Minimal stand-in for the parts of the real schema the retention migration
-- touches. Column names, types, nullability and FKs mirror the migrations so
-- that anything the real file would trip over trips here too.

-- Supabase's stock roles, so REVOKE statements resolve.
do $$ begin
  create role anon;          exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role;  exception when duplicate_object then null; end $$;

create schema if not exists cron;

-- pg_cron is not in stock Postgres. Stubbed rather than stripped from the
-- migration, so the file under test runs byte-for-byte as it will in production.
create or replace function cron.schedule(text, text, text) returns bigint
  language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(text) returns boolean
  language sql as $$ select true $$;

create type public.code_status    as enum ('active', 'used', 'revoked');
create type public.event_source   as enum ('online', 'offline_replay');
create type public.event_outcome  as enum ('pending', 'admitted', 'rejected', 'collision');
create type public.reject_reason  as enum ('unknown_code', 'expired', 'already_used', 'revoked');
create type public.membership_role as enum ('resident', 'guard', 'admin');

create table public.estates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id        uuid primary key,
  full_name text
);

create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  estate_id  uuid not null references public.estates (id) on delete cascade,
  role       public.membership_role not null,
  unit       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.access_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  estate_id     uuid not null references public.estates (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  status        public.code_status not null default 'active',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  swept_at      timestamptz
);

create table public.verification_events (
  id                        uuid primary key default gen_random_uuid(),
  client_event_id           uuid not null,
  estate_id                 uuid not null references public.estates (id) on delete cascade,
  code_id                   uuid references public.access_codes (id),
  code_attempted            text,
  verified_by_membership_id uuid not null references public.memberships (id),
  verified_at               timestamptz not null,
  synced_at                 timestamptz not null default now(),
  source                    public.event_source not null,
  outcome                   public.event_outcome not null default 'pending',
  reject_reason             public.reject_reason,
  collision                 boolean not null default false,
  pool_age_seconds          integer,
  admitted_without_match    boolean not null default false,
  constraint verification_events_dedupe_key
    unique (verified_by_membership_id, client_event_id)
);

create table public.guard_shifts (
  id                uuid primary key default gen_random_uuid(),
  estate_id         uuid not null references public.estates (id) on delete cascade,
  membership_id     uuid not null references public.memberships (id) on delete cascade,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  ended_by_handover boolean not null default false
);
