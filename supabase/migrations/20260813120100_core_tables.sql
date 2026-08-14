-- Estate Access Platform — identity, tenants, memberships
-- Technical Design v2.0 §2.1–2.3, §7

-- ─── 2.1 profiles ─────────────────────────────────────────────────────────────
-- One row per human, keyed 1:1 to auth.users. Email and password live in
-- auth.users and are managed by Supabase Auth — we do not duplicate them here.

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  phone      text,
  full_name  text,
  created_at timestamptz not null default now()
);

-- A profile row must always exist for an authenticated user, so create it from
-- the auth trigger rather than trusting the client to do it after sign-up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── 2.2 estates ──────────────────────────────────────────────────────────────

create table public.estates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  address      text,
  contact_info text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ─── 2.3 memberships ──────────────────────────────────────────────────────────
-- The core of the model: one human = one auth user; a membership grants them a
-- role at an estate. Move-out deactivates the membership, never the account.

create table public.memberships (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  estate_id      uuid not null references public.estates (id) on delete cascade,
  role           public.membership_role not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  deactivated_at timestamptz,

  -- a person holds a given role at most once per estate
  constraint memberships_user_estate_role_key unique (user_id, estate_id, role)
);

-- Every RLS policy and every RPC resolves membership through this index, which
-- makes it the hottest index in the schema.
create index memberships_active_lookup_idx
  on public.memberships (user_id, estate_id, role)
  where is_active;

create index memberships_estate_idx on public.memberships (estate_id) where is_active;

-- ─── 7. platform admins ───────────────────────────────────────────────────────
-- Deliberately a separate table rather than a boolean on profiles: a
-- client-updatable profile row carrying an is_platform_owner flag is a
-- privilege-escalation vector waiting for one careless RLS policy.

create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
