-- Estate Access Platform — guard shifts
--
-- Until now "Start your shift" in the guard app was nothing but a sign-in: no
-- shift was recorded anywhere, so nothing could be said about who was on the
-- gate. This adds the entity, and with it the one notification residents asked
-- for — "a guard is on duty" — sent ONCE when the shift opens.
--
-- The one-guard-at-a-time rule (Technical Design §5, and the reason offline
-- verification is safe) is enforced here rather than assumed: opening a shift
-- closes whoever held the post, so the estate can never have two open shifts.

-- ─── Table ────────────────────────────────────────────────────────────────────

create table public.guard_shifts (
  id            uuid primary key default gen_random_uuid(),
  estate_id     uuid not null references public.estates (id)     on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  -- Set when this shift was closed by someone else taking the post, rather
  -- than by the guard ending it. Reads differently in an audit: a handover is
  -- routine, a guard who never signed off is worth a question.
  ended_by_handover boolean not null default false,

  constraint guard_shifts_ends_after_start check (ended_at is null or ended_at >= started_at)
);

comment on table public.guard_shifts is
  'One row per period a guard held the gate. At most one open row per estate.';

-- THE constraint that makes one-guard-at-a-time real rather than a convention.
-- A partial unique index on estate_id where the shift is open: a second open
-- shift at the same estate cannot be inserted, whatever the application does.
create unique index guard_shifts_one_open_per_estate
  on public.guard_shifts (estate_id)
  where ended_at is null;

create index guard_shifts_estate_started_idx
  on public.guard_shifts (estate_id, started_at desc);

create index guard_shifts_membership_idx
  on public.guard_shifts (membership_id, started_at desc);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
--
-- SELECT only. Like access_codes and verification_events, the sole write path
-- is the SECURITY DEFINER functions below — no client INSERT/UPDATE/DELETE
-- policy exists, and none should be added. A guard who could close another
-- estate's shift, or forge one, is a tenant-isolation hole.

alter table public.guard_shifts enable row level security;

-- Residents need this to see who is on duty; guards and admins to see the post.
-- Scoped to the caller's own estate, like every other estate-scoped read.
create policy guard_shifts_select_own_estate
  on public.guard_shifts
  for select
  to authenticated
  using (public.has_membership(estate_id));

-- A policy without the matching GRANT silently fails with 42501 (see CLAUDE.md).
grant select on public.guard_shifts to authenticated;

-- ─── start_shift ──────────────────────────────────────────────────────────────
--
-- Returns a status row; never raises for an expected outcome. A raise would
-- abort the transaction and take the shift row and the queued notifications
-- with it.
--
-- Results:
--   ok               — shift opened, residents notified
--   already_on_shift — this guard already holds the post; NOT re-notified
--   not_a_guard      — no active guard membership at this estate

create function public.start_shift(p_estate_id uuid)
returns table (result text, shift_id uuid, started_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard      uuid := public.current_membership(p_estate_id, 'guard');
  v_open_id    uuid;
  v_open_by    uuid;
  v_shift      public.guard_shifts;
  v_guard_name text;
begin
  if v_guard is null then
    return query select 'not_a_guard'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- Serialise per estate. Two guards tapping "start" together would otherwise
  -- both see no open shift, both try to insert, and one would hit the partial
  -- unique index as a raw 23505 instead of a handled handover.
  perform pg_advisory_xact_lock(hashtextextended(p_estate_id::text, 0));

  select gs.id, gs.membership_id into v_open_id, v_open_by
    from public.guard_shifts gs
   where gs.estate_id = p_estate_id and gs.ended_at is null;

  -- Already on duty. Return the shift they are already holding WITHOUT
  -- queueing anything: this is what makes the notification once-per-shift.
  -- The guard app calls this on every sign-in and on resume, so without this
  -- branch every app launch would push the whole estate again.
  if v_open_by = v_guard then
    select * into v_shift from public.guard_shifts where id = v_open_id;
    return query select 'already_on_shift'::text, v_shift.id, v_shift.started_at;
    return;
  end if;

  -- Someone else held the post. Close it — this is the handover the guard app
  -- describes, and it keeps the one-open-shift index satisfiable.
  if v_open_id is not null then
    update public.guard_shifts
       set ended_at = now(), ended_by_handover = true
     where id = v_open_id;
  end if;

  insert into public.guard_shifts (estate_id, membership_id)
  values (p_estate_id, v_guard)
  returning * into v_shift;

  select p.full_name into v_guard_name
    from public.memberships m
    join public.profiles p on p.id = m.user_id
   where m.id = v_guard;

  -- ONE message for the whole estate, not one per resident.
  --
  -- The dispatcher fans out to push tokens. Enqueuing per-resident would put
  -- a row on the queue for every household on the estate every time a shift
  -- opens — thousands of messages carrying identical text, and a fan-out the
  -- dispatcher can do with a single join.
  --
  -- Same transaction as the insert (§2.7): if the shift does not commit, the
  -- notification does not either, so nobody is told about a shift that never
  -- started.
  perform pgmq.send('notifications', jsonb_build_object(
    'kind',       'shift_started',
    'estate_id',  p_estate_id,
    'shift_id',   v_shift.id,
    'guard_name', coalesce(nullif(btrim(v_guard_name), ''), 'A guard'),
    'started_at', v_shift.started_at
  ));

  return query select 'ok'::text, v_shift.id, v_shift.started_at;
end;
$$;

-- ─── end_shift ────────────────────────────────────────────────────────────────
--
-- Deliberately silent. Residents are told when someone comes ON duty so they
-- know their visitor can be received; telling them the gate is now unmanned
-- is both alarming and an invitation, and nobody asked for it.

create function public.end_shift(p_estate_id uuid)
returns table (result text, shift_id uuid, ended_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard uuid := public.current_membership(p_estate_id, 'guard');
  v_shift public.guard_shifts;
begin
  if v_guard is null then
    return query select 'not_a_guard'::text, null::uuid, null::timestamptz;
    return;
  end if;

  update public.guard_shifts
     set ended_at = now()
   where estate_id = p_estate_id
     and membership_id = v_guard
     and ended_at is null
  returning * into v_shift;

  if v_shift.id is null then
    return query select 'no_open_shift'::text, null::uuid, null::timestamptz;
    return;
  end if;

  return query select 'ok'::text, v_shift.id, v_shift.ended_at;
end;
$$;

-- ─── current_shift ────────────────────────────────────────────────────────────
--
-- Who holds the gate right now. The resident app shows this so "a guard is on
-- duty" survives a missed or dismissed notification — a push is a nudge, never
-- the only route to a fact.

create function public.current_shift(p_estate_id uuid)
returns table (shift_id uuid, guard_name text, started_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select gs.id,
         coalesce(nullif(btrim(p.full_name), ''), 'A guard'),
         gs.started_at
    from public.guard_shifts gs
    join public.memberships m on m.id = gs.membership_id
    join public.profiles    p on p.id = m.user_id
   where gs.estate_id = p_estate_id
     and gs.ended_at is null
     -- The caller must belong to this estate. Without this the function is a
     -- cross-tenant read of who is on duty anywhere.
     and public.has_membership(p_estate_id);
$$;

-- ─── Grants ───────────────────────────────────────────────────────────────────
--
-- EXECUTE is granted to PUBLIC by default, so every function above is
-- anon-callable until revoked. This was a real bug here before; see CLAUDE.md.

revoke execute on function public.start_shift(uuid)    from public, anon;
revoke execute on function public.end_shift(uuid)      from public, anon;
revoke execute on function public.current_shift(uuid)  from public, anon;

grant execute on function public.start_shift(uuid)     to authenticated;
grant execute on function public.end_shift(uuid)       to authenticated;
grant execute on function public.current_shift(uuid)   to authenticated;

-- ─── Queue access for the dispatcher ──────────────────────────────────────────
--
-- The Edge Function reaches Postgres through PostgREST, which only exposes the
-- schemas listed in config.toml — `public` and `graphql_public`. The `pgmq`
-- schema is not among them (and is explicitly revoked from anon/authenticated
-- in queue.sql), so the dispatcher cannot call pgmq.read directly. These are
-- the two narrow doors it goes through instead.
--
-- Granted to service_role ONLY. Draining the notification queue means reading
-- every resident's pending notifications; an authenticated caller must never
-- be able to do it, and the default EXECUTE-to-PUBLIC grant means "must never"
-- has to be written down as a REVOKE.

create function public.notifications_read(p_qty integer, p_vt integer)
returns table (msg_id bigint, message jsonb)
language sql
volatile
security definer
set search_path = ''
as $$
  select r.msg_id, r.message
    from pgmq.read('notifications', p_vt, p_qty) as r;
$$;

create function public.notifications_archive(p_msg_id bigint)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select pgmq.archive('notifications', p_msg_id);
$$;

revoke execute on function public.notifications_read(integer, integer) from public, anon, authenticated;
revoke execute on function public.notifications_archive(bigint)        from public, anon, authenticated;

grant execute on function public.notifications_read(integer, integer)  to service_role;
grant execute on function public.notifications_archive(bigint)         to service_role;
