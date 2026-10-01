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

-- pgcrypto lives in `extensions` on Supabase, and generate_code / the dues
-- pay_token both call extensions.gen_random_bytes.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- pg_net and Vault are Supabase platform pieces. Stubbed so the cron migration
-- runs byte-for-byte as it will in production.
create schema if not exists net;
create schema if not exists vault;
create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}',
                                          timeout_milliseconds integer default 5000)
  returns bigint language sql as $$ select 1::bigint $$;
create table if not exists vault.decrypted_secrets (name text primary key, decrypted_secret text);

create schema if not exists pgmq;
create table if not exists pgmq.sent (msg_id bigserial primary key, queue text, message jsonb);
create or replace function pgmq.send(p_queue text, p_msg jsonb) returns bigint
  language sql as $$ insert into pgmq.sent (queue, message) values (p_queue, p_msg) returning msg_id $$;

create schema if not exists cron;

-- pg_cron is not in stock Postgres. Stubbed rather than stripped from the
-- migration, so the file under test runs byte-for-byte as it will in production.
-- A real table, so a test can assert a job was actually scheduled rather than
-- that the call did not throw.
create table if not exists cron.job (jobid bigserial primary key, jobname text unique,
                                     schedule text, command text);

create or replace function cron.schedule(p_name text, p_sched text, p_cmd text) returns bigint
  language sql as $$
    insert into cron.job (jobname, schedule, command) values (p_name, p_sched, p_cmd)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
    returning jobid;
  $$;
create or replace function cron.unschedule(p_name text) returns boolean
  language sql as $$ delete from cron.job where jobname = p_name; select true; $$;

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
  id    uuid primary key,
  email text,
  -- Real Supabase has this and landlord access depends on it: an account is
  -- linked to a house by its CONFIRMED email matching what the estate
  -- recorded. A stub without it would let every fixture user pass as verified
  -- and quietly retire the most important test in supabase/tests/landlord.sql.
  --
  -- Defaulted to now() so the hundreds of existing fixtures across the other
  -- suites stay confirmed without being rewritten; the landlord tests pass
  -- NULL explicitly where an unconfirmed account is the point.
  email_confirmed_at timestamptz default now(),
  -- Real Supabase column. The guard profile reports it: "never signed in" is
  -- how an admin spots a guard account that was created but never handed over.
  last_sign_in_at timestamptz
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

create table public.houses (
  id             uuid primary key default gen_random_uuid(),
  estate_id      uuid not null references public.estates (id) on delete cascade,
  house_code     text not null,
  house_number   text not null,
  landlord_name  text,
  landlord_phone text,
  landlord_email text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

-- By ALTER, as the real schema does: houses postdates memberships, which is
-- also why house_id is nullable there.
alter table public.memberships
  add column house_id uuid references public.houses (id) on delete set null;

create table public.code_mint_attempts (
  membership_id uuid not null references public.memberships (id) on delete cascade,
  window_start  timestamptz not null,
  hits          integer not null default 1,
  primary key (membership_id, window_start)
);

-- Mirrors public.generate_code from 20260813120700, including the
-- extensions.gen_random_bytes call and the 31-glyph alphabet.
create or replace function public.generate_code(p_len integer default 6)
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes    bytea := extensions.gen_random_bytes(p_len);
  v_out      text := '';
  i          integer;
begin
  for i in 0 .. p_len - 1 loop
    v_out := v_out || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 31), 1);
  end loop;
  return v_out;
end $$;

create table public.access_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  estate_id     uuid not null references public.estates (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  status        public.code_status not null default 'active',
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  swept_at      timestamptz,
  is_delivery   boolean not null default false,
  delivery_note text
);

create unique index access_codes_live_code_key
  on public.access_codes (estate_id, code) where status = 'active' and swept_at is null;

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
