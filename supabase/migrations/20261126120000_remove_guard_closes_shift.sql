-- Removing a guard takes them off the gate, not only off the list.
--
-- deactivate_membership (20260813120700) is the one way an estate admin ends
-- somebody's access: it was wired to the residents' Suspend button, and the
-- dashboard now calls it from a guard's profile too. For a guard it already
-- did what matters at the gate -- current_membership stops resolving, so
-- verify_access_code and sync_pull refuse them at once -- but it left their
-- open shift open. guard_shifts allows one open shift per estate, so a guard
-- removed mid-shift went on showing as "On duty" on the dashboard and in the
-- residents' app until the next guard signed in and took the post as a
-- "handover" from somebody who no longer worked there.
--
-- Now the shift closes in the same transaction. ended_by_handover stays false:
-- the shift ended because the estate removed them, not because somebody took
-- over, and the audit reads the difference.
--
-- Everything else is unchanged: same signature, same checks, same revocation
-- of the member's live codes (residents have codes, guards have none), same
-- wake-up for the estate's gate phones.

create or replace function public.deactivate_membership(p_membership_id uuid)
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

  -- A removed guard is off duty from this moment. Not a handover: nobody
  -- took the post from them.
  update public.guard_shifts
     set ended_at = now()
   where membership_id = p_membership_id
     and ended_at is null;

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

-- CREATE OR REPLACE keeps existing grants; restated so this file alone says
-- who may call it.
revoke execute on function public.deactivate_membership(uuid) from public, anon;
grant  execute on function public.deactivate_membership(uuid) to authenticated;
