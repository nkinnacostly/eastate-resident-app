-- Estate Access Platform — Row Level Security
-- Technical Design v2.0 §2.9
--
-- This migration is what turns "every estate-scoped query filters on estate_id"
-- from an instruction a developer has to remember into a guarantee the database
-- enforces. Read §2.9 before changing anything here.

-- ─── Helpers ──────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER is REQUIRED on these, not stylistic: a policy on memberships
-- that itself queries memberships recurses infinitely. Running the lookup as
-- owner steps outside RLS and breaks the cycle.
--
-- auth.uid() is wrapped in a scalar subquery — (select auth.uid()) — so Postgres
-- evaluates it once as an InitPlan instead of once per row. On a table scan the
-- difference is order-of-magnitude, and it is the most common RLS performance
-- mistake.

create function public.has_membership(p_estate_id uuid, p_role text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships m
     where m.user_id   = (select auth.uid())
       and m.estate_id = p_estate_id
       and m.is_active
       and (p_role is null or m.role = p_role::public.membership_role)
  );
$$;

create function public.current_membership(p_estate_id uuid, p_role text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
    from public.memberships m
   where m.user_id   = (select auth.uid())
     and m.estate_id = p_estate_id
     and m.role      = p_role::public.membership_role
     and m.is_active;
$$;

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
     where pa.user_id = (select auth.uid())
  );
$$;

-- ─── Enable RLS everywhere ────────────────────────────────────────────────────
-- A table in `public` with RLS off is readable by anyone holding an anon key.

alter table public.profiles            enable row level security;
alter table public.estates             enable row level security;
alter table public.memberships         enable row level security;
alter table public.platform_admins     enable row level security;
alter table public.access_codes        enable row level security;
alter table public.verification_events enable row level security;
alter table public.push_tokens         enable row level security;
alter table public.code_mint_attempts  enable row level security;

-- ─── profiles ─────────────────────────────────────────────────────────────────

create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: admins read their estate's members"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.user_id = profiles.id
         and m.is_active
         and public.has_membership(m.estate_id, 'admin')
    )
  );

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ─── estates ──────────────────────────────────────────────────────────────────

create policy "estates: members read their own estate"
  on public.estates for select to authenticated
  using (public.has_membership(id) or public.is_platform_admin());

-- No write policies: estates are created via rpc('create_estate').

-- ─── memberships ──────────────────────────────────────────────────────────────
-- A resident sees only their own memberships, not the neighbour list. Admins
-- see everyone at their estate.

create policy "memberships: read own or as estate admin"
  on public.memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_membership(estate_id, 'admin')
    or public.is_platform_admin()
  );

-- No write policies: invite / deactivate go through RPCs.

-- ─── platform_admins ──────────────────────────────────────────────────────────

create policy "platform_admins: read own row"
  on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- ─── access_codes ─────────────────────────────────────────────────────────────
--
-- SELECT ONLY. There is deliberately no INSERT/UPDATE/DELETE policy: with RLS
-- enabled and no write policy, direct writes fail — not by convention, but
-- because no policy permits them. The sole write path is a SECURITY DEFINER
-- function (§1).
--
-- DO NOT ADD A WRITE POLICY HERE. That missing policy is what stops someone
-- burning a code outside the atomic path with two lines of client SQL.

create policy "access_codes: residents read their own, admins read the estate's"
  on public.access_codes for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.id = access_codes.membership_id
         and m.user_id = (select auth.uid())
    )
    or public.has_membership(estate_id, 'admin')
  );

-- ─── verification_events ──────────────────────────────────────────────────────
-- SELECT ONLY, same reasoning as access_codes.

create policy "verification_events: admins read the estate's, guards read their own"
  on public.verification_events for select to authenticated
  using (
    public.has_membership(estate_id, 'admin')
    or exists (
      select 1 from public.memberships m
       where m.id = verification_events.verified_by_membership_id
         and m.user_id = (select auth.uid())
    )
  );

-- ─── push_tokens ──────────────────────────────────────────────────────────────
-- Owned by the device's own membership, so clients manage these directly.

create policy "push_tokens: manage own"
  on public.push_tokens for all to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.id = push_tokens.membership_id
         and m.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
       where m.id = push_tokens.membership_id
         and m.user_id = (select auth.uid())
    )
  );

-- ─── code_mint_attempts ───────────────────────────────────────────────────────
-- No policies at all. Touched only by definer functions, so no client can read
-- the rate limiter's state or write to it.

-- ─── Defence in depth: revoke the grants too ──────────────────────────────────
--
-- RLS already denies these, but Supabase grants table privileges to anon and
-- authenticated by default. Removing the grant means a future accidental
-- "just add a policy" cannot open a write path on its own — someone would have
-- to deliberately re-grant as well.

revoke insert, update, delete on public.access_codes        from anon, authenticated;
revoke insert, update, delete on public.verification_events from anon, authenticated;
revoke insert, update, delete on public.estates             from anon, authenticated;
revoke insert, update, delete on public.memberships         from anon, authenticated;
revoke insert, update, delete on public.platform_admins     from anon, authenticated;
revoke all                    on public.code_mint_attempts  from anon, authenticated;

-- anon has no business anywhere in this schema.
revoke all on all tables in schema public from anon;
