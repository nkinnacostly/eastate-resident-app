-- The guard licence columns, renamed from psira_* (20261030100000).
--
-- Runs after detail-views.sql in the same database and reuses its fixtures:
-- Gary Gate is an officer of Agency X posted to Estate A; e1 administers
-- Agency X, a1 administers Estate A, d0 is the platform owner.
--
-- A rename is only done when nothing still asks for the old name and every
-- reader returns the value under the new one, so both halves are checked.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label;
  end if;
end $$;

-- The "nothing raised" failure is raised outside the block that catches it, or
-- it catches itself and passes (see operator-dues.sql).
create or replace function pg_temp.raises(label text, sql text, want text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception
    when others then
      if sqlerrm like '%' || want || '%' then
        raise notice 'PASS  % (%)', label, want;
        return;
      end if;
      raise exception 'FAIL  % (wanted %, got %)', label, want, sqlerrm;
  end;
  raise exception 'FAIL  % (expected %, nothing raised)', label, want;
end $$;

\set gary   '''c9000000-0000-4000-8000-000000000005'''
\set licence '''NSCDC/PGC/0042'''

-- ─── Nothing asks for the old names ──────────────────────────────────────────

select pg_temp.check('profiles has the four licence columns and no psira_ column', (
  select count(*) filter (where column_name in
           ('licence_number', 'licence_grade', 'licence_expires_at', 'licence_verified_at')) = 4
     and count(*) filter (where column_name like 'psira%') = 0
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'));

select pg_temp.check('the grade constraint is renamed with its column', (
  select count(*) filter (where conname = 'profiles_licence_grade_ck') = 1
     and count(*) filter (where conname = 'profiles_psira_grade_ck') = 0
    from pg_constraint where conrelid = 'public.profiles'::regclass));

-- A body still naming a dropped column parses fine and fails only when called,
-- which is why this reads every function's source rather than trusting the list.
select pg_temp.check('no function body or result still names a psira_ column', (
  select count(*) = 0
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.prosrc like '%psira\_%' or pg_get_function_result(p.oid) like '%psira\_%')));

select pg_temp.check('record_psira_registration is gone; record_guard_licence replaces it', (
  to_regprocedure('public.record_psira_registration(uuid, text, text, timestamptz)') is null
  and to_regprocedure('public.record_guard_licence(uuid, text, text, timestamptz)') is not null));

select pg_temp.check('record_guard_licence keeps definer rights and an empty search_path', (
  select p.prosecdef and 'search_path=""' = any (p.proconfig)
    from pg_proc p where p.oid = 'public.record_guard_licence(uuid, text, text, timestamptz)'::regprocedure));

-- Dropping and creating a function resets its grants, so they are re-checked.
select pg_temp.check('grants survived the drop and create', (
  not has_function_privilege('anon', 'public.record_guard_licence(uuid, text, text, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.record_guard_licence(uuid, text, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.estate_guard_profile(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.estate_guard_profile(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.guard_profile_row(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.guard_profile_row(uuid)', 'execute')));

-- ─── Recording a licence ─────────────────────────────────────────────────────

-- An attestation is the employer's, never the officer's about themselves.
set test.uid = 'c9000000-0000-4000-8000-000000000005';
select pg_temp.raises('an officer cannot record their own licence',
  $$select public.record_guard_licence('c9000000-0000-4000-8000-000000000005', 'NSCDC/PGC/0042')$$,
  'not_this_officer_s_employer');

-- A Nigerian licence: no grade, and that is valid.
set test.uid = 'c9000000-0000-4000-8000-0000000000e1';
select public.record_guard_licence(:gary, :licence, null, now() + interval '1 year');

select pg_temp.check('the agency records a licence with no grade, stamped as checked now', (
  select licence_number = 'NSCDC/PGC/0042' and licence_grade is null
     and licence_expires_at > now() and licence_verified_at > now() - interval '1 minute'
    from public.profiles where id = :gary));

select pg_temp.raises('a grade off the A-E ladder is still refused',
  $$select public.record_guard_licence('c9000000-0000-4000-8000-000000000005', 'NSCDC/PGC/0042', 'Z')$$,
  'profiles_licence_grade_ck');

-- ─── Every reader returns it under the new name ──────────────────────────────

select pg_temp.check('agency roster', (
  select registration_number = 'NSCDC/PGC/0042' and grade is null and registration_checked_at is not null
    from public.agency_roster('b9000000-0000-4000-8000-00000000000a')
   where full_name = 'Gary Gate'));

select pg_temp.check('agency monthly return', (
  select bool_and(registration_number = 'NSCDC/PGC/0042')
    from public.agency_monthly_return('b9000000-0000-4000-8000-00000000000a', current_date)
   where officer_name = 'Gary Gate'));

select public.agency_officer_detail('ab900000-0000-4000-8000-000000000005') as d \gset off_
select pg_temp.check('agency officer detail', (
  select d->'officer'->>'licence_number' = 'NSCDC/PGC/0042'
     and d->'officer' ? 'licence_grade' and d->'officer' ? 'licence_verified_at'
     and position('psira' in d::text) = 0
    from (select :'off_d'::jsonb as d) x));

set test.uid = 'c9000000-0000-4000-8000-0000000000a1';
select pg_temp.check('estate admin guard profile', (
  select g.licence_number = 'NSCDC/PGC/0042' and g.licence_expires_at is not null
     and not (to_jsonb(g) ? 'psira_registration_number')
    from public.estate_guard_profile('e9000000-0000-4000-8000-00000000000a',
                                     'a9000000-0000-4000-8000-000000000005') g));

set test.uid = 'c9000000-0000-4000-8000-0000000000d0';
select public.operator_person_detail(:gary) as d \gset op_
select pg_temp.check('platform owner person view, and the guard stats inside it', (
  select d->'person'->>'licence_number' = 'NSCDC/PGC/0042'
     and d->'guard'->0->>'licence_number' = 'NSCDC/PGC/0042'
     and position('psira' in d::text) = 0
    from (select :'op_d'::jsonb as d) x));

reset test.uid;
