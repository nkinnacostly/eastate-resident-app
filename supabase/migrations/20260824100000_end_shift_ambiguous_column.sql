-- Estate Access Platform — fix end_shift: ambiguous "ended_at"
--
-- end_shift has never worked. Every call fails with 42702:
--
--   column reference "ended_at" is ambiguous
--   It could refer to either a PL/pgSQL variable or a table column.
--
-- The function is declared `returns table (result text, shift_id uuid,
-- ended_at timestamptz)`. In plpgsql those OUT columns are ordinary variables
-- in the function's scope, so the unqualified `ended_at` in
--
--   where ... and ended_at is null
--
-- could mean the OUT variable or guard_shifts.ended_at, and Postgres refuses
-- to guess. It resolves at RUN time, not at CREATE time, which is why the
-- function was created cleanly and failed only when a guard signed out.
--
-- Why it went unnoticed: the guard app fires end_shift and then signs out
-- regardless of the result, so the screen did exactly what the guard expected
-- while the shift stayed open in the database. The visible consequence is
-- subtle but real — `current_shift` keeps naming a guard who has gone home,
-- and residents are told the wrong person is on the gate until someone else
-- starts a shift and the handover closes it.
--
-- start_shift is unaffected: every reference there is already alias-qualified.
--
-- The fix is to alias the table and qualify the reference, matching how
-- start_shift and current_shift were already written. Renaming the OUT column
-- would work too, but it is part of the function's contract — the guard app
-- reads `ended_at` off the result — so the name stays and the reference gets
-- explicit instead.

create or replace function public.end_shift(p_estate_id uuid)
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

  -- `gs` alias + qualified column: unambiguous against the OUT variable of the
  -- same name. Note `set ended_at` needs no alias — the left side of a SET is
  -- always a column, never a variable.
  update public.guard_shifts gs
     set ended_at = now()
   where gs.estate_id = p_estate_id
     and gs.membership_id = v_guard
     and gs.ended_at is null
  returning gs.* into v_shift;

  if v_shift.id is null then
    return query select 'no_open_shift'::text, null::uuid, null::timestamptz;
    return;
  end if;

  return query select 'ok'::text, v_shift.id, v_shift.ended_at;
end;
$$;

-- CREATE OR REPLACE resets nothing about privileges here (the function already
-- existed with the right grants), but being explicit keeps this migration
-- correct if it is ever replayed against a database where it does not.
revoke execute on function public.end_shift(uuid) from public, anon;
grant  execute on function public.end_shift(uuid) to authenticated;
