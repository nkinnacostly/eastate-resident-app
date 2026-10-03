-- Detail views — every detail RPC, executed on the LINKED project, as the role
-- it is for.
--
-- Run:  npm run test:db:detail
--
-- Why this exists: the throwaway-Postgres suites (test:detail-views) run the
-- migrations against a hand-written stand-in schema, and PL/pgSQL does not
-- check a query against the real tables until the query RUNS. A function can
-- deploy cleanly and still fail on its first call. The client-query test only
-- proves a function exists and is callable; this proves it answers.
--
-- READ-ONLY. Every detail RPC is STABLE and nothing here writes. It reports key
-- names, list lengths and error messages -- never a name, email or phone --
-- because it runs against real people's data and its output lands in a
-- terminal.
--
-- Fixtures are PICKED from live data, not inserted. Where the platform has no
-- example of something (no agency yet, no landlord with an account), that row
-- reports SKIP rather than passing.
--
-- Pure SQL, no psql meta-commands: `supabase db query` is not psql.

create temp table results (seq int, name text, detail text, pass boolean);

do $$
declare
  v_owner        uuid;
  v_admin_user   uuid;
  v_estate       uuid;
  v_resident     uuid;
  v_resident_uid uuid;
  v_house        uuid;
  v_guard        uuid;
  v_foreign_res  uuid;
  v_agency       uuid;
  v_agency_admin uuid;
  v_officer      uuid;
  v_agency_est   uuid;
  v_landlord     uuid;
  v_ll_house     uuid;
  r              jsonb;
  rt             record;

  -- Shape only: sorted top-level keys and, for arrays, their length.
  -- Never a value.
  function_shape text;
begin
  -- ─── Pick real fixtures ────────────────────────────────────────────────────
  select pa.user_id into v_owner from public.platform_admins pa limit 1;

  select m.user_id, m.estate_id into v_admin_user, v_estate
    from public.memberships m
   where m.role = 'admin' and m.is_active
     and exists (select 1 from public.memberships x
                  where x.estate_id = m.estate_id and x.role = 'resident')
   order by m.created_at
   limit 1;

  select m.id, m.user_id into v_resident, v_resident_uid
    from public.memberships m
   where m.estate_id = v_estate and m.role = 'resident'
   order by m.house_id is null, m.created_at
   limit 1;

  select h.id into v_house from public.houses h where h.estate_id = v_estate
   order by h.created_at limit 1;

  select m.id into v_guard from public.memberships m
   where m.estate_id = v_estate and m.role = 'guard' order by m.created_at limit 1;

  -- A resident somewhere ELSE, for the cross-tenant check.
  select m.id into v_foreign_res from public.memberships m
   where m.role = 'resident' and m.estate_id <> v_estate limit 1;

  select am.agency_id, am.user_id into v_agency, v_agency_admin
    from public.agency_memberships am
   where am.role = 'admin' and am.is_active limit 1;
  select am.id into v_officer from public.agency_memberships am
   where am.agency_id = v_agency order by am.role = 'officer' desc limit 1;
  select c.estate_id into v_agency_est from public.agency_contracts c
   where c.agency_id = v_agency limit 1;

  select u.id, h.id into v_landlord, v_ll_house
    from public.houses h
    join auth.users u
      on lower(btrim(u.email)) = lower(btrim(h.landlord_email))
     and u.email_confirmed_at is not null
   limit 1;

  -- ─── Run each RPC as its caller ────────────────────────────────────────────
  --
  -- One sub-block per call: SET LOCAL ROLE inside it is undone if the call
  -- raises (the sub-transaction rolls back), and undone by RESET ROLE if it
  -- does not, so the INSERT into the temp table always runs as the owner.

  for rt in
    select * from (values
      (1, 'estate admin: a resident',      v_admin_user,   'resident'::text),
      (2, 'estate admin: a house',          v_admin_user,   'house'),
      (3, 'estate admin: a guard (refactored)', v_admin_user, 'guard'),
      (4, 'estate admin: another estate''s resident is null', v_admin_user, 'foreign'),
      (5, 'owner: an estate',               v_owner,        'op_estate'),
      (6, 'owner: a person',                v_owner,        'op_person'),
      (7, 'agency: an officer',             v_agency_admin, 'ag_officer'),
      (8, 'agency: an estate',              v_agency_admin, 'ag_estate'),
      (9, 'landlord: their house',          v_landlord,     'landlord')
    ) t(seq, name, caller, kind)
  loop
    if rt.caller is null
       or (rt.kind = 'guard' and v_guard is null)
       or (rt.kind = 'house' and v_house is null)
       or (rt.kind = 'foreign' and v_foreign_res is null)
       or (rt.kind in ('ag_officer', 'ag_estate') and (v_officer is null or v_agency_est is null)) then
      insert into results values (rt.seq, rt.name, 'skipped: no example on the platform', null);
      continue;
    end if;

    begin
      perform set_config('request.jwt.claims',
        json_build_object('sub', rt.caller, 'role', 'authenticated')::text, true);
      set local role authenticated;

      r := case rt.kind
        when 'resident'   then public.estate_resident_detail(v_estate, v_resident)
        when 'house'      then public.estate_house_detail(v_estate, v_house)
        when 'guard'      then (select to_jsonb(g) from public.estate_guard_profile(v_estate, v_guard) g)
        when 'foreign'    then public.estate_resident_detail(v_estate, v_foreign_res)
        when 'op_estate'  then public.operator_estate_detail(v_estate)
        when 'op_person'  then public.operator_person_detail(v_resident_uid)
        when 'ag_officer' then public.agency_officer_detail(v_officer)
        when 'ag_estate'  then public.agency_estate_detail(v_agency, v_agency_est)
        when 'landlord'   then public.landlord_house_detail(v_ll_house)
      end;

      reset role;

      select string_agg(
               k || case jsonb_typeof(r -> k)
                      when 'array' then '[' || jsonb_array_length(r -> k) || ']'
                      else '' end,
               ',' order by k)
        into function_shape
        from jsonb_object_keys(coalesce(r, '{}'::jsonb)) k;

      insert into results values (
        rt.seq, rt.name,
        case when r is null then 'null' else function_shape end,
        case when rt.kind = 'foreign' then r is null
             else r is not null and jsonb_typeof(r) = 'object' end);
    exception when others then
      insert into results values (rt.seq, rt.name, 'ERROR: ' || sqlerrm, false);
    end;
  end loop;
end $$;

select seq,
       case when pass is null then 'SKIP' when pass then 'PASS' else 'FAIL' end as status,
       name, detail
  from results
 order by seq;
