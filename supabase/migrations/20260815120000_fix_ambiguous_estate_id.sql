-- Fix: "column reference estate_id is ambiguous" (42702) in request_estate_access.
--
-- The function declares `returns table (result text, estate_id uuid, estate_name text)`,
-- and in plpgsql an OUT column is an ordinary variable in scope for the whole
-- body. So in
--
--     select 1 from public.memberships
--      where user_id = v_user and estate_id = v_estate.id
--
-- `estate_id` could mean the OUT parameter or memberships.estate_id, and
-- Postgres refuses to guess.
--
-- What makes this worth calling out: the failure is on the SUCCESS path only.
-- An unknown join code returns before those lookups and worked fine, so the
-- function appeared healthy while every valid code raised. Tests that only
-- checked rejection would have passed.
--
-- Fixed by aliasing each table and qualifying the columns, which is immune to
-- whatever the OUT parameters happen to be named.

create or replace function public.request_estate_access(
  p_join_code text,
  p_unit      text default null
)
returns table (result text, estate_id uuid, estate_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_window timestamptz := date_trunc('minute', now());
  v_limit  constant integer := 5;
  v_hits   integer;
  v_norm   text;
  v_estate public.estates;
  v_unit   text := nullif(btrim(p_unit), '');
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Count the attempt BEFORE deciding anything, and never RAISE for an expected
  -- outcome: an exception aborts the transaction and rolls the counter back
  -- with it, so the limiter would only ever count successes (§3.2).
  insert into public.join_attempts (user_id, window_start, hits)
  values (v_user, v_window, 1)
  on conflict (user_id, window_start)
  do update set hits = join_attempts.hits + 1
  returning hits into v_hits;

  if v_hits > v_limit then
    return query select 'rate_limited'::text, null::uuid, null::text;
    return;
  end if;

  -- Normalise: strip anything that is not a letter or digit, then uppercase, so
  -- "9y9e-aeyh" and "9Y9EAEYH" are the same code.
  v_norm := upper(regexp_replace(coalesce(p_join_code, ''), '[^A-Za-z0-9]', '', 'g'));

  select e.* into v_estate from public.estates e where e.join_code = v_norm;

  if v_estate.id is null then
    return query select 'unknown_code'::text, null::uuid, null::text;
    return;
  end if;

  if exists (
    select 1 from public.memberships m
     where m.user_id = v_user and m.estate_id = v_estate.id and m.is_active
  ) then
    return query select 'already_a_member'::text, v_estate.id, v_estate.name;
    return;
  end if;

  if exists (
    select 1 from public.join_requests j
     where j.user_id = v_user and j.estate_id = v_estate.id and j.status = 'pending'
  ) then
    return query select 'already_pending'::text, v_estate.id, v_estate.name;
    return;
  end if;

  insert into public.join_requests (user_id, estate_id, requested_unit)
  values (v_user, v_estate.id, v_unit);

  return query select 'ok'::text, v_estate.id, v_estate.name;
end;
$$;

revoke execute on function public.request_estate_access(text, text) from public, anon;
grant  execute on function public.request_estate_access(text, text) to authenticated;
