-- The guard's "Host" line should name the HOUSE, not the deprecated unit text.
--
-- verify_access_code read memberships.unit, which houses replaced. A resident
-- approved after the houses migration has house_id set and unit only as a copy;
-- one approved before has unit only. coalesce covers both without a backfill
-- that would rewrite history.

create or replace function public.verify_access_code(
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
    -- The HOUSE is the address now; m.unit is the deprecated free-text copy
    -- kept only for rows predating the houses table.
    case when v_event.outcome = 'admitted' then coalesce(h.house_number, m.unit) end
  from (select 1) _
  left join public.access_codes ac on ac.id = v_event.code_id
  left join public.memberships   m on m.id  = ac.membership_id
  left join public.houses        h on h.id  = m.house_id
  left join public.profiles      p on p.id  = m.user_id;
end;
$$;

revoke execute on function public.verify_access_code(uuid, text, uuid) from public, anon;
grant  execute on function public.verify_access_code(uuid, text, uuid) to authenticated;
