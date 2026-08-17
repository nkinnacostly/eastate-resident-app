-- Record WHICH code was attempted, not just whether it resolved.
--
-- verification_events stored `code_id` and nothing else, so a rejected attempt
-- that matched no code produced a row with code_id = NULL and no trace of what
-- the guard actually typed. The audit log could say "something was refused at
-- 02:11" but never what — which is precisely the case the log exists for:
-- someone at the gate with a code that does not work.
--
-- The typed string was already being passed to _ingest_verification_event as
-- p_code and used to resolve code_id; it was simply thrown away afterwards.
--
-- Stored normalised (uppercase, trimmed) to match how codes are generated and
-- compared, so searching the audit log for a code finds it regardless of how it
-- was typed.

alter table public.verification_events
  add column if not exists code_attempted text;

comment on column public.verification_events.code_attempted is
  'The code string as typed at the gate, normalised. Present even when code_id '
  'is null, which is the whole point: an unknown code must still be auditable.';

create index if not exists verification_events_code_attempted_idx
  on public.verification_events (estate_id, code_attempted);

create or replace function public._ingest_verification_event(
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
