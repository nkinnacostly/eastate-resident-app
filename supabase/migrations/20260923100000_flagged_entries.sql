-- Make "admit anyway and flag it" actually reach the estate admin.
--
-- THE BUG
--
-- The guard app offers an override: when the gate is offline and a code is not
-- in the local pool, the guard can admit the visitor on their own judgement.
-- The verdict screen promises "when signal returns this goes to the estate
-- admin to reconcile, with your name on it". It did not.
--
-- The outbox row carried outcome = 'flagged', but the replay
-- (ingest_verification_events) never sent the outcome at all — it forwarded
-- client_event_id, code_id, code, verified_at and pool_age_seconds and nothing
-- else. So the server re-derived a verdict from the code string alone, and for
-- the only case the override exists for (a code that resolves to nothing) that
-- verdict was 'rejected' / 'unknown_code'.
--
-- The permanent record therefore said a person was TURNED AWAY at the gate,
-- when a guard had in fact let them through. That is the exact inverse of what
-- happened, in an append-only audit log, and it is the one entry an admin most
-- needs to review.
--
-- The dashboard's "Flagged entries" page tried to recover the fact by
-- deriving it: outcome = 'admitted' AND source = 'offline_replay' AND no host
-- name. That predicate is unsatisfiable. An event is only ever 'admitted'
-- because the conditional burn matched a row, so code_id is never null on an
-- admitted event, so the host always resolves. The page could never show
-- anything, and did not.
--
-- WHY A STORED COLUMN, AND NOT A BETTER DERIVATION
--
-- The page's comment argued that deriving beats "a column that could drift out
-- of step with the event it describes". Sound instinct, wrong call here: the
-- flag is a fact about a DECISION A HUMAN MADE AT A GATE while holding a phone
-- that knew nothing. No amount of server-side state can reconstruct it after
-- the fact, because the server's own view of the code may have changed in the
-- meantime — that is the whole reason the guard had to override. It has to be
-- carried, so it is stored.
--
-- The outcome stays 'admitted', because that is what happened to the visitor.

alter table public.verification_events
  add column if not exists admitted_without_match boolean not null default false;

comment on column public.verification_events.admitted_without_match is
  'The guard used the admit-and-flag override: they let the visitor through '
  'while the device had no matching code. A claim made by the gate, not a '
  'verdict computed by the server — it is the one thing about an offline '
  'entry that cannot be re-derived later. Drives the admin dashboard''s '
  'Flagged entries page.';

-- Rare by construction, so a partial index stays tiny and keeps a future
-- server-side filter from scanning the whole log.
create index if not exists verification_events_flagged_idx
  on public.verification_events (estate_id, synced_at desc)
  where admitted_without_match;

-- ---------------------------------------------------------------------------
-- _ingest_verification_event gains p_flagged.
--
-- The old 8-argument function MUST be dropped, not left alongside. Adding a
-- 9th parameter with a default does not replace it — Postgres would then see
-- the existing 8-argument calls (verify_access_code's, among others) as
-- ambiguous between the two candidates and fail every one with 42725
-- "function is not unique". Same trap as grant_membership in
-- 20260814130000_membership_unit.sql.
-- ---------------------------------------------------------------------------

drop function if exists public._ingest_verification_event(
  uuid, uuid, uuid, uuid, text, timestamptz, public.event_source, integer);

create function public._ingest_verification_event(
  p_client_event_id uuid,
  p_membership_id   uuid,          -- the verifying guard, ALREADY VERIFIED
  p_estate_id       uuid,
  p_code_id         uuid,          -- offline callers pass this...
  p_code            text,          -- ...online callers pass this
  p_verified_at     timestamptz,
  p_source          public.event_source,
  p_pool_age        integer,
  -- The gate's claim that the guard overrode a refusal. Defaulted so the
  -- online path (verify_access_code) keeps calling with 8 arguments: an
  -- override is only ever something a guard does to a LOCAL verdict, and
  -- there is no override of a server refusal by design — that would be
  -- admitting a code the server authoritatively refused.
  p_flagged         boolean default false
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
  v_flagged  boolean := coalesce(p_flagged, false);
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
    client_event_id, estate_id, code_id, code_attempted, verified_by_membership_id,
    verified_at, synced_at, source, outcome, collision, pool_age_seconds)
  values (
    p_client_event_id, p_estate_id, v_code_id, upper(btrim(p_code)), p_membership_id,
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

  -- 3. unresolvable code string.
  if v_code_id is null then
    if v_flagged then
      -- The override, and the case it exists for. There is nothing to burn and
      -- nobody to notify — we do not know whose visitor this was, which is
      -- precisely what the admin has to reconcile. Recorded as admitted
      -- because the visitor was admitted; the flag is what makes it reviewable
      -- rather than indistinguishable from a normal entry.
      update public.verification_events
         set outcome = 'admitted', admitted_without_match = true
       where id = v_event.id
      returning * into v_event;
    else
      -- Record the attempt, burn nothing. Failed attempts are part of the
      -- audit trail (§2.5).
      update public.verification_events
         set outcome = 'rejected', reject_reason = 'unknown_code'
       where id = v_event.id
      returning * into v_event;
    end if;
    return v_event;
  end if;

  -- 4. the conditional burn (§4.1). `status = 'active'` is the guard against
  --    double-burn: a second attempt matches zero rows. The estate_id
  --    predicate is what stops a guard burning another tenant's code even with
  --    a valid code_id.
  --
  --    A flagged event still burns. The guard overrode a verdict their DEVICE
  --    reached; if the code turns out to be real and live — minted during the
  --    outage, which is the commonest reason the pool missed it — then it has
  --    genuinely been used and must not stay spendable. The flag is kept
  --    either way, so the admin sees that the override happened and that it
  --    turned out to be sound.
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

    -- The guard let them in and the code was NOT spendable — expired, revoked,
    -- or already burned at another gate. The server's reason is the true one
    -- and is kept, but the person is through the gate either way, so the flag
    -- has to survive or the entry reads as an ordinary refusal.
    if v_flagged then
      v_outcome := 'admitted'; v_collide := false;
    end if;
  end if;

  update public.verification_events
     set outcome                = v_outcome,
         collision              = v_collide,
         reject_reason          = v_reason,
         admitted_without_match = v_flagged
   where id = v_event.id
  returning * into v_event;

  return v_event;
end;
$$;

-- Internal machinery: reachable by nobody but the definer chain. The drop
-- above took the old signature's grants with it, so this has to be re-asserted
-- against the NEW signature or the function is left executable by PUBLIC —
-- functions are granted EXECUTE to PUBLIC by default.
revoke execute on function public._ingest_verification_event(
  uuid, uuid, uuid, uuid, text, timestamptz, public.event_source, integer, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The replay wrapper forwards the gate's claim.
-- ---------------------------------------------------------------------------

create or replace function public.ingest_verification_events(
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
      (e ->> 'pool_age_seconds')::integer,
      -- coalesced, not passed raw: a guard app built before this change sends
      -- no 'flagged' key at all, and ->> on a missing key is NULL, which would
      -- override the parameter default rather than fall back to it.
      coalesce((e ->> 'flagged')::boolean, false)
    );
  end loop;
end;
$$;

revoke execute on function public.ingest_verification_events(uuid, jsonb) from public, anon;
grant  execute on function public.ingest_verification_events(uuid, jsonb) to authenticated;
