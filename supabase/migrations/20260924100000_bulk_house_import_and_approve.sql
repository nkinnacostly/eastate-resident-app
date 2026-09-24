-- Bulk house import, and bulk approval of join requests.
--
-- Both exist for the same reason: onboarding an estate is a few hundred
-- repetitions of a one-row operation, and an admin doing it through the UI one
-- row at a time is the thing that kills a rollout before the first visitor
-- code is ever generated.
--
-- WHY THESE ARE RPCs AND NOT LOOPS IN THE BROWSER
--
-- The browser could call create_house 300 times. That is 300 round trips, 300
-- authorization checks, and a half-finished estate if the laptop lid closes at
-- number 180 -- with no record of where it stopped. One call that reports a
-- row per input is both faster and recoverable.

-- ---------------------------------------------------------------------------
-- create_houses_bulk
--
-- RE-UPLOADING THE SAME FILE IS SAFE, AND THAT IS THE POINT.
--
-- An admin exports the estate roll, imports it, notices three houses were
-- missing, adds them to the spreadsheet and imports the whole thing again.
-- That is the normal way this gets used, not a mistake to be punished. So a
-- house that already exists is reported as 'duplicate' and SKIPPED -- the
-- batch carries on, and the existing house keeps the code already printed on
-- whatever letter went out. Nothing is updated and no code is rotated.
--
-- Duplicates also come back carrying their existing house_code, which makes
-- the import result a complete handout list on every run rather than only on
-- the first.
-- ---------------------------------------------------------------------------

create or replace function public.create_houses_bulk(
  p_estate_id uuid,
  p_houses    jsonb
)
returns table (seq int, house_number text, house_code text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  e            jsonb;
  i            int := 0;
  v_number     text;
  v_code       text;
  v_try        text;
  v_constraint text;
begin
  -- Checked ONCE for the batch rather than per row: the estate is a parameter
  -- of the call, not of each row, so there is nothing a later row could do to
  -- change who is asking.
  if public.current_membership(p_estate_id, 'admin') is null
     and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if p_houses is null or jsonb_typeof(p_houses) <> 'array' then
    raise exception 'houses_must_be_an_array' using errcode = '22023';
  end if;

  -- A ceiling, not a target. Estates are hundreds of homes; a file claiming
  -- 50,000 is a mis-parsed spreadsheet, and finding that out after twenty
  -- minutes of subtransactions helps nobody.
  if jsonb_array_length(p_houses) > 2000 then
    raise exception 'too_many_houses' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_houses) loop
    i := i + 1;
    v_number := nullif(btrim(e ->> 'house_number'), '');
    v_code   := null;

    -- A blank house number is reported, never guessed at. Trailing empty rows
    -- are ordinary in an exported spreadsheet, and inventing "House 0" for one
    -- would put a dwelling in the estate that does not exist.
    if v_number is null then
      seq := i; house_number := null; house_code := null; status := 'invalid';
      return next;
      continue;
    end if;

    begin
      -- Find a free code. 4 glyphs is ~1.05M per estate, so a collision is
      -- ordinary rather than exceptional -- same loop as create_house.
      loop
        v_try := public.generate_code(4);
        exit when not exists (
          select 1 from public.houses h
           where h.estate_id = p_estate_id and h.house_code = v_try
        );
      end loop;

      insert into public.houses (
        estate_id, house_code, house_number,
        landlord_name, landlord_phone, landlord_email)
      values (
        p_estate_id, v_try, v_number,
        nullif(btrim(e ->> 'landlord_name'), ''),
        nullif(btrim(e ->> 'landlord_phone'), ''),
        nullif(btrim(e ->> 'landlord_email'), ''))
      returning houses.house_code into v_code;

      seq := i; house_number := v_number; house_code := v_code; status := 'created';
      return next;

    exception when unique_violation then
      -- WHICH uniqueness failed matters. houses_estate_number_key means the
      -- house is already on the roll, which is the expected re-upload case.
      -- houses_estate_code_key means two sessions generated the same 4-glyph
      -- code between the check above and this insert -- vanishingly rare, and
      -- NOT a duplicate house. Calling both 'duplicate' would quietly tell an
      -- admin a house exists when it does not.
      get stacked diagnostics v_constraint = constraint_name;

      if v_constraint = 'houses_estate_number_key' then
        select h.house_code into v_code
          from public.houses h
         where h.estate_id = p_estate_id and h.house_number = v_number;
        seq := i; house_number := v_number; house_code := v_code; status := 'duplicate';
      else
        -- Re-uploading the file fixes it, because this row created nothing.
        seq := i; house_number := v_number; house_code := null; status := 'failed';
      end if;
      return next;
    end;
  end loop;
end;
$$;

comment on function public.create_houses_bulk(uuid, jsonb) is
  'Create many houses in one call. Existing house numbers are skipped and '
  'reported as duplicate carrying their current code -- never updated, never '
  'rotated -- so importing the same roll twice is safe and converges.';

-- ---------------------------------------------------------------------------
-- approve_join_requests_bulk
--
-- Deliberately a LOOP OVER approve_join_request, not a reimplementation of it.
--
-- That function derives its authority from the request's own estate, so an
-- admin at estate A cannot approve a resident into estate B (see
-- 20260815140000). Re-stating that rule here would mean two copies of the one
-- check that stops cross-tenant approval, and the copy in the bulk path -- the
-- one handling hundreds of ids at a time -- would be the more dangerous to get
-- wrong. Calling through keeps it in exactly one place.
--
-- So a list containing another estate's request does not fail the batch and
-- does not approve it: that row comes back 'failed', and the rest go through.
-- ---------------------------------------------------------------------------

create or replace function public.approve_join_requests_bulk(p_request_ids uuid[])
returns table (request_id uuid, status text, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r uuid;
begin
  if p_request_ids is null or array_length(p_request_ids, 1) is null then
    return;
  end if;

  if array_length(p_request_ids, 1) > 500 then
    raise exception 'too_many_requests' using errcode = '22023';
  end if;

  foreach r in array p_request_ids loop
    begin
      perform public.approve_join_request(r);
      request_id := r; status := 'approved'; detail := null;
      return next;
    exception when others then
      -- Per-row, so one already-decided request (two admins clearing the queue
      -- at once, which is exactly when this button gets used) cannot roll back
      -- the approvals that did succeed. The reason is carried out rather than
      -- swallowed.
      request_id := r; status := 'failed'; detail := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

comment on function public.approve_join_requests_bulk(uuid[]) is
  'Approve many join requests in one call by looping over '
  'approve_join_request, so the per-request estate authority check is not '
  'duplicated. Reports one row per id; a failure never rolls back the rest.';

-- ─── grants ──────────────────────────────────────────────────────────────────
--
-- Functions are EXECUTE-to-PUBLIC by default, so both are anon-callable until
-- revoked. Neither is safe to leave that way: one writes houses, the other
-- grants estate membership.

revoke execute on function public.create_houses_bulk(uuid, jsonb)        from public, anon;
revoke execute on function public.approve_join_requests_bulk(uuid[])     from public, anon;

grant  execute on function public.create_houses_bulk(uuid, jsonb)        to authenticated;
grant  execute on function public.approve_join_requests_bulk(uuid[])     to authenticated;
