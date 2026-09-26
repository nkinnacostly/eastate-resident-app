-- Stand-in for the parts of the real schema the retention, agency and PSIRA
-- migrations touch. Column names, types, nullability and FKs mirror the real
-- migrations so that anything those files would trip over trips here too.
--
-- It is NOT the real schema: no RLS, no policies, no triggers beyond the ones
-- under test. `npm run test:db` is what exercises those, against a real
-- project. This answers "does this migration do what it says".

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
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  address      text,
  contact_info text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Supabase puts users in its own schema and the agency tables reference it.
create schema if not exists auth;

create table auth.users (
  id uuid primary key
);

-- auth.uid() is what every definer function derives identity from. Backed by a
-- settable GUC so a test can say who is calling.
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create table public.profiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  phone     text,
  full_name text
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function public.is_platform_admin() returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
  ) $$;


create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  estate_id  uuid not null references public.estates (id) on delete cascade,
  role       public.membership_role not null,
  unit       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),

  -- Mirrors the real schema: one row per person per role per estate, which is
  -- what place_officer_at_estate's ON CONFLICT depends on.
  unique (user_id, estate_id, role)
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

-- Declared last: it reads public.memberships, which is created above.
create or replace function public.current_membership(p_estate_id uuid, p_role text)
returns uuid language sql stable security definer set search_path = ''
as $$
  select m.id from public.memberships m
   where m.user_id   = (select auth.uid())
     and m.estate_id = p_estate_id
     and m.role      = p_role::public.membership_role
     and m.is_active;
$$;
