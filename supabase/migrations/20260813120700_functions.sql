-- Estate Access Platform — the RPC surface
-- Technical Design v2.0 §3, §4, §5, §8
--
-- EVERY function here is SECURITY DEFINER and therefore bypasses RLS. That is
-- deliberate and is the one sanctioned write path (§1). The rule that keeps it
-- safe: identity comes from auth.uid(), NEVER from an argument. p_estate_id is
-- client-supplied, but it is CHECKED (via current_membership) rather than
-- trusted. A definer function that accepts p_membership_id is a
-- tenant-isolation hole with extra steps.
--
-- `set search_path = ''` on every one of them forces fully-qualified names and
-- closes the search-path hijack that definer-rights functions are prone to.

-- ─── 3. Code generation ───────────────────────────────────────────────────────
--
-- pgcrypto, not random(). These are access credentials; random() is a
-- predictable PRNG seeded per session, so a leaked seed makes future codes
-- guessable.
--
-- 256 % 31 != 0, so the low glyphs are ~3% over-represented. Against an 887M
-- space with a 6-hour window that is immaterial — noted so nobody rediscovers
-- it as a bug.

create function public.generate_code(p_len integer default 6)
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 31 glyphs
  v_bytes    bytea := extensions.gen_random_bytes(p_len);
  v_out      text := '';
  i          integer;
begin
  for i in 0 .. p_len - 1 loop
    v_out := v_out || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 31), 1);
  end loop;
  return v_out;
end;
$$;

-- ─── 3.1 Mint a code (cap + rate limit) ───────────────────────────────────────
--
-- Concurrency notes, because this is subtler than it looks:
--
--  * A single `insert ... where (select count ...) < 3` is NOT safe. Under READ
--    COMMITTED each command starts with a fresh snapshot taken at command
--    start, so two concurrent inserts are phantoms to each other: both count 2,
--    both insert, the resident ends up with 4.
--  * Wrapping pg_advisory_xact_lock() into a CTE of that same statement does
--    not rescue it either — the snapshot was taken before the lock was
--    acquired, so the loser still cannot see the winner's committed row.
--  * Inside plpgsql each statement takes its own snapshot, so a count taken
--    AFTER the advisory lock does see it. That is why this is a function.
--
-- It NEVER raises for an expected outcome. raise exception aborts the
-- transaction, which would roll back the rate-limit increment with it — so an
-- account parked at the cap could hammer this forever and never advance a
-- counter, and the "rate limit" would only ever count SUCCESSFUL mints.
-- Exactly inverted from its purpose.

create function public.mint_access_code(p_estate_id uuid)
returns table (result text, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_limit    constant integer := 10;   -- requests per minute (§3.2)
  v_live     integer;
  v_hits     integer;
  v_code     text;
  v_expires  timestamptz := now() + interval '6 hours';
  v_attempt  integer := 0;
begin
  -- identity from the JWT, never from an argument
  v_membership_id := public.current_membership(p_estate_id, 'resident');

  if v_membership_id is null then
    return query select 'not_a_resident'::text, null::text, null::timestamptz;
    return;
  end if;

  -- serialize minting for THIS membership; released at commit, never contends
  -- across residents
  perform pg_advisory_xact_lock(hashtextextended(v_membership_id::text, 0));

  -- rate limit: count this attempt whatever its outcome (§3.2)
  insert into public.code_mint_attempts (membership_id, window_start, hits)
  values (v_membership_id, date_trunc('minute', now()), 1)
  -- In ON CONFLICT DO UPDATE the existing row is referenced by the target
  -- table's NAME, not a schema-qualified path — `public.code_mint_attempts.hits`
  -- does not resolve here.
  on conflict (membership_id, window_start)
  do update set hits = code_mint_attempts.hits + 1
  returning hits into v_hits;

  if v_hits > v_limit then
    return query select 'rate_limited'::text, null::text, null::timestamptz;
    return;
  end if;

  select count(*) into v_live
    from public.access_codes ac
   where ac.membership_id = v_membership_id
     and ac.status = 'active'
     and ac.expires_at > now();

  if v_live >= 3 then
    return query select 'code_limit_reached'::text, null::text, null::timestamptz;
    return;
  end if;

  -- mint + regenerate-on-collision, all inside this transaction.
  -- The exception block runs in a subtransaction, so catching the conflict
  -- rolls back only the failed insert — not the counter, not the lock.
  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_code(6);
    begin
      insert into public.access_codes
        (code, estate_id, membership_id, status, expires_at)
      values
        (v_code, p_estate_id, v_membership_id, 'active', v_expires);

      return query select 'ok'::text, v_code, v_expires;
      return;
    exception when unique_violation then
      if v_attempt >= 5 then
        return query select 'code_collision'::text, null::text, null::timestamptz;
        return;
      end if;
    end;
  end loop;
end;
$$;

-- ─── 5.3 Ingest a verification event (INTERNAL) ───────────────────────────────
--
-- Dedupe BEFORE evaluating collision. This ordering is the whole point: a
-- retried push always targets an already-burned code — its own earlier burn —
-- so a server that checks collision first reports every flaky-network retry as
-- a double-entry and buries the admin's review queue in false positives.
--
-- Not granted to any client role. Reached only via the two wrappers below,
-- which resolve p_membership_id from auth.uid().

create function public._ingest_verification_event(
  p_client_event_id uuid,
  p_membership_id   uuid,          -- the verifying guard, ALREADY VERIFIED
  p_estate_id       uuid,
  p_code_id         uuid,          -- offline callers pass this...
  p_code            text,          -- ...online callers pass this
  p_verified_at     timestamptz,
  p_source          public.event_source,
  p_pool_age        integer
)
returns public.verification_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event    public.verification_events;
  v_code_id  uuid := p_code_id;
  v_burned   uuid;
  v_owner    uuid;
  v_code_str text;
  v_outcome  public.event_outcome;
  v_reason   public.reject_reason;
  v_collide  boolean;
  v_status   public.code_status;
begin
  -- 0. resolve string -> id INSIDE the transaction (§4.1). Prefer an active
  --    row; fall back to the most recent so a used/revoked code still reports
  --    precisely. Resolving OUTSIDE would risk a false collision, since a code
  --    string is legally reusable once the old row leaves 'active'.
  if v_code_id is null and p_code is not null then
    select ac.id into v_code_id
      from public.access_codes ac
     where ac.estate_id = p_estate_id
       and ac.code = p_code
     order by (ac.status = 'active') desc, ac.created_at desc
     limit 1;
  end if;

  -- 1. claim the event id. wins exactly once, ever.
  insert into public.verification_events (
    client_event_id, estate_id, code_id, verified_by_membership_id,
    verified_at, synced_at, source, outcome, collision, pool_age_seconds)
  values (
    p_client_event_id, p_estate_id, v_code_id, p_membership_id,
    p_verified_at, now(), p_source, 'pending', false, p_pool_age)
  on conflict (verified_by_membership_id, client_event_id) do nothing
  returning * into v_event;

  -- 2. already ingested -> replay the STORED verdict, never recompute one.
  --    Recomputing is what turns a lost ack into a phantom collision.
  if v_event.id is null then
    select * into v_event
      from public.verification_events ve
     where ve.verified_by_membership_id = p_membership_id
       and ve.client_event_id = p_client_event_id;
    return v_event;
  end if;

  -- 3. unresolvable code string -> record the attempt, burn nothing.
  --    Failed attempts are part of the audit trail (§2.5).
  if v_code_id is null then
    update public.verification_events
       set outcome = 'rejected', reject_reason = 'unknown_code'
     where id = v_event.id
    returning * into v_event;
    return v_event;
  end if;

  -- 4. the conditional burn (§4.1). `status = 'active'` is the guard against
  --    double-burn: a second attempt matches zero rows. The estate_id
  --    predicate is what stops a guard burning another tenant's code even with
  --    a valid code_id.
  update public.access_codes
     set status = 'used',
         used_at = p_verified_at,
         verified_by_membership_id = p_membership_id
   where id = v_code_id
     and estate_id = p_estate_id
     and status = 'active'
     and expires_at > now()
  returning id, membership_id, code into v_burned, v_owner, v_code_str;

  if v_burned is not null then
    v_outcome := 'admitted'; v_collide := false; v_reason := null;

    -- 5. notify the resident. Same transaction as the burn (§2.7). A replayed
    --    duplicate returns at step 2 and never reaches here, so a retried push
    --    cannot re-notify.
    perform pgmq.send('notifications', jsonb_build_object(
      'kind',          'code_used',
      'membership_id', v_owner,
      'code',          v_code_str,
      'verified_at',   p_verified_at
    ));
  else
    select ac.status into v_status
      from public.access_codes ac
     where ac.id = v_code_id and ac.estate_id = p_estate_id;

    if v_status = 'used' then
      -- burned by a DIFFERENT event: a genuine double-entry
      v_outcome := 'collision'; v_collide := true;  v_reason := 'already_used';
    elsif v_status = 'revoked' then
      v_outcome := 'rejected';  v_collide := false; v_reason := 'revoked';
    else
      v_outcome := 'rejected';  v_collide := false; v_reason := 'expired';
    end if;
  end if;

  update public.verification_events
     set outcome = v_outcome, collision = v_collide, reject_reason = v_reason
   where id = v_event.id
  returning * into v_event;

  return v_event;
end;
$$;

-- ─── 4.1 Online verification (public wrapper) ─────────────────────────────────

create function public.verify_access_code(
  p_estate_id       uuid,
  p_code            text,
  p_client_event_id uuid
)
returns public.verification_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard uuid := public.current_membership(p_estate_id, 'guard');
begin
  -- Unlike the cap in §3.1, this IS an authorization failure rather than an
  -- expected outcome with state worth committing. Aborting is correct.
  if v_guard is null then
    raise exception 'not_a_guard_at_this_estate' using errcode = '42501';
  end if;

  return public._ingest_verification_event(
    p_client_event_id, v_guard, p_estate_id,
    null, p_code, now(), 'online', null);
end;
$$;

-- ─── 5.3 Offline replay (public wrapper, batch) ───────────────────────────────
--
-- The whole batch is one transaction, so a poison event rolls back the entire
-- push and the device retries all of it. Safe (ingest is idempotent) but one
-- malformed event blocks a guard's queue. If that shows up in practice, wrap
-- the loop body in a per-event begin/exception block.

create function public.ingest_verification_events(
  p_estate_id uuid,
  p_events    jsonb
)
returns setof public.verification_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard uuid := public.current_membership(p_estate_id, 'guard');
  e jsonb;
begin
  if v_guard is null then
    raise exception 'not_a_guard_at_this_estate' using errcode = '42501';
  end if;

  for e in select * from jsonb_array_elements(p_events) loop
    return next public._ingest_verification_event(
      (e ->> 'client_event_id')::uuid,
      v_guard,
      p_estate_id,
      (e ->> 'code_id')::uuid,
      e ->> 'code',
      (e ->> 'verified_at')::timestamptz,
      'offline_replay',
      (e ->> 'pool_age_seconds')::integer
    );
  end loop;
end;
$$;

-- ─── 5.2 Sync pull ────────────────────────────────────────────────────────────
--
-- Returns upserts AND tombstones. A purely additive feed can never tell the
-- device that a code stopped being valid, so a revoked code would keep
-- verifying at the gate until its natural expiry.
--
-- Expiry NEVER arrives as a tombstone: nothing mutates the row when the clock
-- passes expires_at, so sync_seq never bumps. The device ages its own pool
-- against expires_at, which it already checks on every verification (§4.2) and
-- which works with no connectivity at all. Do not "fix" this with a
-- server-side expiry sweep — that makes the janitor load-bearing.

create function public.sync_pull(p_estate_id uuid, p_cursor bigint default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard   uuid := public.current_membership(p_estate_id, 'guard');
  v_limit   constant integer := 500;
  v_upserts jsonb;
  v_tombs   jsonb;
  v_cursor  bigint;
begin
  if v_guard is null then
    raise exception 'not_a_guard_at_this_estate' using errcode = '42501';
  end if;

  with page as (
    select ac.*
      from public.access_codes ac
     where ac.estate_id = p_estate_id
       and ac.sync_seq > p_cursor
     order by ac.sync_seq
     limit v_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'code', p.code, 'expires_at', p.expires_at))
      filter (where p.status = 'active' and p.expires_at > now()), '[]'::jsonb),
    coalesce(jsonb_agg(p.id)
      filter (where p.status <> 'active'), '[]'::jsonb),
    coalesce(max(p.sync_seq), p_cursor)
  into v_upserts, v_tombs, v_cursor
  from page p;

  return jsonb_build_object(
    'upserts',    v_upserts,
    'tombstones', v_tombs,
    'cursor',     v_cursor
  );
end;
$$;

-- ─── 5.4 Membership deactivation ──────────────────────────────────────────────

create function public.deactivate_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estate_id uuid;
  v_admin     uuid;
  v_guard     uuid;
begin
  select m.estate_id into v_estate_id
    from public.memberships m where m.id = p_membership_id;

  if v_estate_id is null then
    raise exception 'membership_not_found' using errcode = 'P0002';
  end if;

  v_admin := public.current_membership(v_estate_id, 'admin');
  if v_admin is null then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  update public.memberships
     set is_active = false, deactivated_at = now()
   where id = p_membership_id;

  -- Invalidate outstanding codes in the SAME transaction. This bumps each
  -- row's sync_seq, so they arrive as tombstones on the next pull.
  update public.access_codes
     set status = 'revoked',
         revoked_at = now(),
         revoked_by_membership_id = v_admin,
         revoked_reason = 'membership_deactivated'
   where membership_id = p_membership_id
     and status = 'active';

  -- Collapse the offline revocation window from minutes to seconds where the
  -- device is reachable (§5.4). We do not model "on duty", so wake every active
  -- guard at the estate; a spurious pull is free.
  for v_guard in
    select m.id from public.memberships m
     where m.estate_id = v_estate_id and m.role = 'guard' and m.is_active
  loop
    perform pgmq.send('notifications', jsonb_build_object(
      'kind', 'forced_pull', 'membership_id', v_guard));
  end loop;
end;
$$;

-- ─── Administration ───────────────────────────────────────────────────────────
--
-- NOTE: inviting a person who has no account yet cannot happen in SQL — it
-- needs auth.admin.inviteUserByEmail, i.e. an Edge Function holding the service
-- role. These functions handle the part that IS relational: granting an
-- existing auth user a role at an estate.

create function public.create_estate(
  p_name         text,
  p_address      text default null,
  p_contact_info text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estate_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  insert into public.estates (name, address, contact_info)
  values (p_name, p_address, p_contact_info)
  returning id into v_estate_id;

  return v_estate_id;
end;
$$;

create function public.grant_membership(
  p_estate_id uuid,
  p_user_id   uuid,
  p_role      text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
begin
  -- an estate admin manages their own estate; the platform owner seeds the
  -- first admin, when no estate admin exists yet
  if public.current_membership(p_estate_id, 'admin') is null
     and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  insert into public.memberships (user_id, estate_id, role)
  values (p_user_id, p_estate_id, p_role::public.membership_role)
  on conflict (user_id, estate_id, role)
  do update set is_active = true, deactivated_at = null
  returning memberships.id into v_membership_id;

  return v_membership_id;
end;
$$;

create function public.register_push_token(
  p_estate_id uuid,
  p_role      text,
  p_token     text,
  p_device_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid := public.current_membership(p_estate_id, p_role);
begin
  if v_membership_id is null then
    raise exception 'no_active_membership' using errcode = '42501';
  end if;

  insert into public.push_tokens (membership_id, expo_push_token, device_id)
  values (v_membership_id, p_token, p_device_id)
  on conflict (membership_id, expo_push_token)
  do update set last_seen_at = now(), device_id = excluded.device_id;
  -- `excluded` is the proposed row; the existing row would be `push_tokens.*`.
end;
$$;

-- ─── Grants ───────────────────────────────────────────────────────────────────
-- Internal machinery is reachable by nobody. The public surface is
-- `authenticated` only — never anon.

revoke execute on function public._ingest_verification_event(
  uuid, uuid, uuid, uuid, text, timestamptz, public.event_source, integer)
  from anon, authenticated, public;

revoke execute on function public.generate_code(integer)        from anon, authenticated, public;
revoke execute on function public.sweep_expired_codes()         from anon, authenticated, public;
revoke execute on function public.sweep_mint_attempts()         from anon, authenticated, public;
revoke execute on function public.bump_sync_seq()               from anon, authenticated, public;
revoke execute on function public.handle_new_user()             from anon, authenticated, public;

grant execute on function public.mint_access_code(uuid)                              to authenticated;
grant execute on function public.verify_access_code(uuid, text, uuid)                to authenticated;
grant execute on function public.ingest_verification_events(uuid, jsonb)             to authenticated;
grant execute on function public.sync_pull(uuid, bigint)                             to authenticated;
grant execute on function public.deactivate_membership(uuid)                         to authenticated;
grant execute on function public.create_estate(text, text, text)                     to authenticated;
grant execute on function public.grant_membership(uuid, uuid, text)                  to authenticated;
grant execute on function public.register_push_token(uuid, text, text, text)         to authenticated;
grant execute on function public.has_membership(uuid, text)                          to authenticated;
grant execute on function public.current_membership(uuid, text)                      to authenticated;
grant execute on function public.is_platform_admin()                                 to authenticated;
