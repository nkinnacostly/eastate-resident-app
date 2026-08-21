-- Estate Access Platform — delivery codes
--
-- A resident issuing a code for a delivery rider can attach instructions
-- ("Leave at the gate, house 14 is the blue one"). The note travels with the
-- code so it can be re-read and re-shared later, rather than living only in the
-- message the resident happened to type at the time.
--
-- Stored server-side rather than passed around the client for two reasons:
-- the share screen already resolves its row from the database instead of route
-- params (a deliberate choice — see app/code/[code].tsx), and a note held only
-- in memory would vanish the moment the resident backgrounded the app, leaving
-- a code they can no longer forward with its instructions.

-- ─── 1. Columns ───────────────────────────────────────────────────────────────

alter table public.access_codes
  add column if not exists is_delivery   boolean not null default false,
  add column if not exists delivery_note text;

comment on column public.access_codes.is_delivery is
  'Resident marked this code as being for a delivery rider.';
comment on column public.access_codes.delivery_note is
  'Free-text instructions for a delivery rider. Only ever set when is_delivery.';

-- A note on a code that is not a delivery is meaningless, and would show up in
-- the share message of a code the resident never marked as one. The length
-- bound is here as well as in the function because a CHECK cannot be bypassed
-- by a future write path that forgets to validate.
alter table public.access_codes
  drop constraint if exists access_codes_delivery_note_ck;

alter table public.access_codes
  add constraint access_codes_delivery_note_ck check (
    (delivery_note is null or is_delivery)
    and (delivery_note is null or char_length(delivery_note) between 1 and 200)
  );

-- Existing rows predate the column and are all is_delivery = false with a null
-- note, so the constraint validates without a rewrite of live data.

-- ─── 2. mint_access_code, now carrying the delivery fields ────────────────────
--
-- The signature changes, so this is a DROP and CREATE rather than a REPLACE:
-- adding parameters with defaults alongside the existing one-argument version
-- would leave two candidates and make `mint_access_code(uuid)` ambiguous.
--
-- Dropping a function drops its grants with it. The REVOKE/GRANT pair at the
-- bottom is not boilerplate — without it EXECUTE reverts to the PUBLIC default
-- and the RPC becomes anon-callable.

drop function if exists public.mint_access_code(uuid);

create function public.mint_access_code(
  p_estate_id     uuid,
  p_is_delivery   boolean default false,
  p_delivery_note text    default null
)
returns table (result text, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_limit    constant integer := 10;   -- requests per minute (§3.2)
  v_note_max constant integer := 200;  -- mirrors MAX_DELIVERY_NOTE_LENGTH
  v_live     integer;
  v_hits     integer;
  v_code     text;
  v_expires  timestamptz := now() + interval '6 hours';
  v_attempt  integer := 0;
  v_delivery boolean := coalesce(p_is_delivery, false);
  v_note     text;
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
  on conflict (membership_id, window_start)
  do update set hits = code_mint_attempts.hits + 1
  returning hits into v_hits;

  if v_hits > v_limit then
    return query select 'rate_limited'::text, null::text, null::timestamptz;
    return;
  end if;

  -- Note handling sits AFTER the counter on purpose. Validating earlier would
  -- be cheaper, but a client looping on malformed input would then never
  -- advance the limiter — the same inversion the no-RAISE rule exists to avoid.
  --
  -- Whitespace-only is treated as no note: a resident who taps through the
  -- sheet without typing gets a plain delivery code, not a code carrying "   ".
  v_note := nullif(btrim(coalesce(p_delivery_note, '')), '');

  -- A note without the flag is dropped rather than honoured. It cannot come
  -- from our own client, and silently storing it would put text in a share
  -- message for a code the resident never marked as a delivery.
  if not v_delivery then
    v_note := null;
  end if;

  -- Rejected, not truncated: silently cutting a resident's instructions in half
  -- produces a message that still sends and still looks fine.
  if v_note is not null and char_length(v_note) > v_note_max then
    return query select 'note_too_long'::text, null::text, null::timestamptz;
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
  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_code(6);
    begin
      insert into public.access_codes
        (code, estate_id, membership_id, status, expires_at, is_delivery, delivery_note)
      values
        (v_code, p_estate_id, v_membership_id, 'active', v_expires, v_delivery, v_note);

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

-- Functions are granted EXECUTE to PUBLIC by default. Re-establish the same
-- posture the dropped version had.
revoke execute on function public.mint_access_code(uuid, boolean, text) from public, anon;
grant  execute on function public.mint_access_code(uuid, boolean, text) to authenticated;
