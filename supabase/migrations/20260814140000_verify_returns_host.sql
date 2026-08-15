-- The guard's admit screen needs to name the host.
--
-- Design: the admit verdict shows "Host — A. Mokoena · Unit 14". The resident
-- app already tells residents what this implies, in the sign-up copy: "Estate
-- admins see your name and unit only. Guards see neither until you issue a
-- code." Issuing a code IS the consent. This migration makes the server able to
-- answer that, which it previously could not.
--
-- Two boundaries are deliberate:
--
--   * Host is returned ONLY on an admitted verdict. A guard who types a code
--     that is expired, revoked or already used learns nothing about whose code
--     it was — otherwise the keypad becomes a resident-directory oracle that
--     anyone holding a guard phone could enumerate.
--   * Host is NOT added to sync_pull. Putting every resident's name and unit
--     into the offline pool on every guard phone would turn a stolen handset
--     into the estate's resident directory. Offline verdicts therefore show no
--     host, and the screen says it was checked on the device.

-- CREATE OR REPLACE cannot change a function's return type, so the old one has
-- to go first. Dropping also drops its grants — they are re-applied below.
drop function if exists public.verify_access_code(uuid, text, uuid);

create function public.verify_access_code(
  p_estate_id       uuid,
  p_code            text,
  p_client_event_id uuid
)
returns table (
  id              uuid,
  client_event_id uuid,
  code_id         uuid,
  outcome         public.event_outcome,
  reject_reason   public.reject_reason,
  collision       boolean,
  verified_at     timestamptz,
  host_name       text,
  host_unit       text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard uuid := public.current_membership(p_estate_id, 'guard');
  v_event public.verification_events;
begin
  -- Unlike the cap in §3.1, this IS an authorization failure rather than an
  -- expected outcome with state worth committing. Aborting is correct.
  if v_guard is null then
    raise exception 'not_a_guard_at_this_estate' using errcode = '42501';
  end if;

  -- The burn still happens in exactly one place.
  v_event := public._ingest_verification_event(
    p_client_event_id, v_guard, p_estate_id,
    null, p_code, now(), 'online', null);

  return query
  select
    v_event.id,
    v_event.client_event_id,
    v_event.code_id,
    v_event.outcome,
    v_event.reject_reason,
    v_event.collision,
    v_event.verified_at,
    -- Populated only for an admitted entry; null on every refusal.
    case when v_event.outcome = 'admitted' then p.full_name end,
    case when v_event.outcome = 'admitted' then m.unit end
  from (select 1) _
  left join public.access_codes ac on ac.id = v_event.code_id
  left join public.memberships   m on m.id  = ac.membership_id
  left join public.profiles      p on p.id  = m.user_id;
end;
$$;

-- A fresh signature is EXECUTE-to-PUBLIC by default, and the drop above took
-- the previous grants with it. Neither is inherited.
revoke execute on function public.verify_access_code(uuid, text, uuid) from public, anon;
grant  execute on function public.verify_access_code(uuid, text, uuid) to authenticated;
