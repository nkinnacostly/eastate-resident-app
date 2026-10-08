-- Security invariants from the October 2026 audit, against the LINKED project.
--
--     npm run test:security
--
-- Every check runs as the real role (authenticated, with a simulated JWT the
-- way PostgREST sets one) against the real schema, policies and grants —
-- because the failures this guards against were all invisible from inside a
-- SECURITY DEFINER function or the migration text, and only showed up as a
-- particular role asking a particular question.
--
-- Fixtures live inside ONE transaction that is rolled back at the end, so the
-- suite leaves nothing behind in production. The query API runs the file as a
-- single transaction and returns the last result set, so the report comes
-- BEFORE the rollback: a failed check raises (and aborts everything), a clean
-- run selects the results and then rolls back.
--
-- scripts/test-security.mjs can also run it with a migration spliced in after
-- the opening `begin;` — a dry run of the migration against production that
-- is rolled back with everything else.

create temp table if not exists sec_results (seq serial, name text, pass boolean, detail text);
truncate sec_results;
grant all on sec_results to authenticated;
grant usage on sequence sec_results_seq_seq to authenticated;

create or replace function pg_temp.ok(p_name text, p_pass boolean, p_detail text default null)
returns void language sql as $$
  insert into sec_results (name, pass, detail) values (p_name, coalesce(p_pass, false), p_detail);
$$;

begin;
-- @@MIGRATION@@

-- ─── Fixtures ────────────────────────────────────────────────────────────────
-- Deterministic ids under 5ec00000-…; all rolled back.

insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at, confirmation_sent_at, raw_app_meta_data)
values
  ('5ec00000-0000-4000-8000-000000000001','sec-res-a@sec.test','authenticated','authenticated','{}', now(), now(), '{}'),
  ('5ec00000-0000-4000-8000-000000000002','sec-adm-a@sec.test','authenticated','authenticated','{}', now(), now(), '{}'),
  ('5ec00000-0000-4000-8000-000000000003','sec-grd-a@sec.test','authenticated','authenticated','{}', now(), now(), '{}'),
  ('5ec00000-0000-4000-8000-000000000004','sec-res-b@sec.test','authenticated','authenticated','{}', now(), now(), '{}'),
  -- A landlord at estate B, and an admin-created account squatting on the
  -- same kind of address: confirmed, but never sent anything.
  ('5ec00000-0000-4000-8000-000000000005','sec-landlord@sec.test','authenticated','authenticated','{}', now(), now(), '{}'),
  ('5ec00000-0000-4000-8000-000000000006','sec-squat@sec.test','authenticated','authenticated','{}', now(), null, '{"email_unproven": true}');

insert into public.estates (id, name, dues_billing_mode, dues_amount_minor, dues_currency,
                            settlement_subaccount_ref, settlement_subaccount_id, settlement_country,
                            settlement_bank_code, settlement_account_number, settlement_account_name,
                            settlement_verified_at)
values
  ('5ec0e000-0000-4000-8000-00000000000a','Sec Estate A','per_resident', 500000, 'NGN',
   'RS_SECTESTA', '1', 'NG', '058', '0123456789', 'SEC ESTATE A', now()),
  ('5ec0e000-0000-4000-8000-00000000000b','Sec Estate B','per_resident', 500000, 'NGN',
   'RS_SECTESTB', '2', 'NG', '058', '9876543210', 'SEC ESTATE B', now());

insert into public.houses (id, estate_id, house_number, landlord_email)
values ('5ec0a000-0000-4000-8000-0000000000b1','5ec0e000-0000-4000-8000-00000000000b','B1','sec-squat@sec.test');

insert into public.memberships (id, user_id, estate_id, role)
values
  ('5ec0b000-0000-4000-8000-000000000001','5ec00000-0000-4000-8000-000000000001','5ec0e000-0000-4000-8000-00000000000a','resident'),
  ('5ec0b000-0000-4000-8000-000000000002','5ec00000-0000-4000-8000-000000000002','5ec0e000-0000-4000-8000-00000000000a','admin'),
  ('5ec0b000-0000-4000-8000-000000000003','5ec00000-0000-4000-8000-000000000003','5ec0e000-0000-4000-8000-00000000000a','guard'),
  ('5ec0b000-0000-4000-8000-000000000004','5ec00000-0000-4000-8000-000000000004','5ec0e000-0000-4000-8000-00000000000b','resident');

insert into public.access_codes (id, code, estate_id, membership_id, expires_at)
values
  ('5ec0c000-0000-4000-8000-0000000000a1','SECAAA','5ec0e000-0000-4000-8000-00000000000a','5ec0b000-0000-4000-8000-000000000001', now() + interval '6 hours'),
  ('5ec0c000-0000-4000-8000-0000000000a2','SECAAB','5ec0e000-0000-4000-8000-00000000000a','5ec0b000-0000-4000-8000-000000000001', now() + interval '6 hours'),
  ('5ec0c000-0000-4000-8000-0000000000b1','SECBBB','5ec0e000-0000-4000-8000-00000000000b','5ec0b000-0000-4000-8000-000000000004', now() + interval '6 hours');

-- ─── 1. No privilege that row-level security cannot see ─────────────────────

select pg_temp.ok('no TRUNCATE/TRIGGER/REFERENCES for anon or authenticated on any public table',
  count(*) = 0, string_agg(distinct table_name || ':' || grantee || ':' || privilege_type, ', '))
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated')
   and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');

-- ─── 2. The estate's bank account ───────────────────────────────────────────

do $$
declare v text; v_name text;
begin
  perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  begin
    select settlement_account_number into v from public.estates where id = '5ec0e000-0000-4000-8000-00000000000a';
    perform pg_temp.ok('a resident cannot read the estate''s settlement account number', false, 'read: ' || coalesce(v, 'null'));
  exception when insufficient_privilege then
    perform pg_temp.ok('a resident cannot read the estate''s settlement account number', true);
  end;
  select name into v_name from public.estates where id = '5ec0e000-0000-4000-8000-00000000000a';
  perform pg_temp.ok('a resident can still read their estate''s name', v_name = 'Sec Estate A', v_name);
  execute 'reset role';
end $$;

select pg_temp.ok('authenticated has no column privilege on any settlement_* column or platform_fee_percent',
  not bool_or(has_column_privilege('authenticated', 'public.estates', c.column_name, 'select')),
  string_agg(c.column_name, ',') filter (where has_column_privilege('authenticated', 'public.estates', c.column_name, 'select')))
  from information_schema.columns c
 where c.table_schema = 'public' and c.table_name = 'estates'
   and (c.column_name like 'settlement\_%' or c.column_name = 'platform_fee_percent');

-- ─── 3. dues_payments' secret columns ───────────────────────────────────────

select pg_temp.ok('authenticated cannot select dues_payments.raw_payload, payer_email or provider_tx_id',
  not (has_column_privilege('authenticated', 'public.dues_payments', 'raw_payload', 'select')
    or has_column_privilege('authenticated', 'public.dues_payments', 'payer_email', 'select')
    or has_column_privilege('authenticated', 'public.dues_payments', 'provider_tx_id', 'select')
    or has_table_privilege('authenticated', 'public.dues_payments', 'select')));

-- ─── 4. A deactivated membership loses its own-row access ───────────────────

update public.memberships set is_active = false where id = '5ec0b000-0000-4000-8000-000000000001';

do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select count(*) into n from public.access_codes where membership_id = '5ec0b000-0000-4000-8000-000000000001';
  perform pg_temp.ok('a moved-out resident no longer reads their old codes', n = 0, n::text);
  begin
    insert into public.push_tokens (membership_id, expo_push_token)
    values ('5ec0b000-0000-4000-8000-000000000001', 'ExponentPushToken[sec-test]');
    perform pg_temp.ok('a moved-out resident cannot register a push token', false, 'insert succeeded');
  exception when insufficient_privilege then
    perform pg_temp.ok('a moved-out resident cannot register a push token', true);
  end;
  execute 'reset role';
end $$;

-- ...but can still remove a token they registered while they lived there.
insert into public.push_tokens (membership_id, expo_push_token)
values ('5ec0b000-0000-4000-8000-000000000001', 'ExponentPushToken[sec-old]');
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  delete from public.push_tokens where expo_push_token = 'ExponentPushToken[sec-old]';
  get diagnostics n = row_count;
  perform pg_temp.ok('a moved-out resident can still delete their own push token on sign-out', n = 1, n::text);
  execute 'reset role';
end $$;

update public.memberships set is_active = true where id = '5ec0b000-0000-4000-8000-000000000001';

-- ─── 5. Confirmed is not proved ─────────────────────────────────────────────

do $$
declare v text; proved boolean;
begin
  perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000006","role":"authenticated","amr":[{"method":"password","timestamp":1}]}', true);
  execute 'set local role authenticated';
  v := public.current_verified_email();
  perform pg_temp.ok('an admin-created account is not a verified email', v is null, v);
  perform pg_temp.ok('so it sees none of the landlord''s houses',
    (select count(*) from public.my_landlord_houses()) = 0);
  begin
    proved := public.prove_email_ownership();
    perform pg_temp.ok('a password session cannot prove the address', proved = false);
    v := public.current_verified_email();
    perform pg_temp.ok('and the account stays unproven after trying', v is null, v);

    perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000006","role":"authenticated","amr":[{"method":"otp","timestamp":1}]}', true);
    proved := public.prove_email_ownership();
    v := public.current_verified_email();
    perform pg_temp.ok('a session opened with an emailed code proves it', proved and v = 'sec-squat@sec.test', v);
  exception when undefined_function then
    perform pg_temp.ok('prove_email_ownership() exists', false);
  end;
  execute 'reset role';
end $$;

do $$
declare v text;
begin
  perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000005","role":"authenticated"}', true);
  execute 'set local role authenticated';
  v := public.current_verified_email();
  perform pg_temp.ok('a self-signed-up, confirmed account is still a verified email', v = 'sec-landlord@sec.test', v);
  execute 'reset role';
end $$;

select pg_temp.ok('only platform admins escaped the backfill of admin-created accounts',
  not exists (
    select 1 from auth.users u
     where u.confirmation_sent_at is null and u.email_confirmed_at is not null
       and coalesce((u.raw_app_meta_data ->> 'email_unproven')::boolean, false) = false
       and not exists (select 1 from public.platform_admins p where p.user_id = u.id)
       and u.id <> '5ec00000-0000-4000-8000-000000000006'));

-- ─── 6. raise_current_dues bills only the caller's estate ───────────────────

do $$
declare n_b int; v_due date;
begin
  perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  execute 'set local role authenticated';
  perform public.raise_current_dues('5ec0e000-0000-4000-8000-00000000000a');
  execute 'reset role';

  select count(*) into n_b from public.dues_charges where estate_id = '5ec0e000-0000-4000-8000-00000000000b';
  perform pg_temp.ok('an admin raising dues at estate A bills nobody at estate B', n_b = 0, n_b::text);

  select due_on into v_due from public.dues_charges
   where membership_id = '5ec0b000-0000-4000-8000-000000000001'
     and period = date_trunc('month', current_date)::date;
  perform pg_temp.ok('it does bill estate A''s resident', v_due is not null);
  perform pg_temp.ok('due a full grace period from today, not from the 1st', v_due >= current_date + 7, v_due::text);
end $$;

-- ─── 7. The revocation reason is the server's, not the caller's ─────────────

do $$
declare v public.revoked_reason;
begin
  perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  perform public.revoke_access_code('5ec0c000-0000-4000-8000-0000000000a2', 'admin_revoked');
  execute 'reset role';
  select revoked_reason into v from public.access_codes where id = '5ec0c000-0000-4000-8000-0000000000a2';
  perform pg_temp.ok('a resident cannot file their cancellation as an admin revocation', v = 'resident_cancelled', v::text);
end $$;

-- ─── 8. A replayed event cannot carry another estate's code ─────────────────

do $$
declare v_code uuid; v_status public.code_status;
begin
  perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  execute 'set local role authenticated';
  select r.code_id into v_code from public.ingest_verification_events(
    '5ec0e000-0000-4000-8000-00000000000a',
    jsonb_build_array(jsonb_build_object(
      'client_event_id', '5ec0d000-0000-4000-8000-000000000001',
      'code_id', '5ec0c000-0000-4000-8000-0000000000b1',
      'code', 'SECBBB',
      'verified_at', now(),
      'pool_age_seconds', 60))) r;
  execute 'reset role';
  perform pg_temp.ok('a guard at A replaying estate B''s code id records no code', v_code is null, v_code::text);
  select status into v_status from public.access_codes where id = '5ec0c000-0000-4000-8000-0000000000b1';
  perform pg_temp.ok('and estate B''s code is still active', v_status = 'active', v_status::text);
end $$;

-- ─── 10. A phone's push token belongs to whoever signed in on it last ───────

do $$
declare n_a int; n_b int;
begin
  perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';
  perform public.register_push_token('5ec0e000-0000-4000-8000-00000000000a', 'resident', 'ExponentPushToken[sec-shared]');
  perform set_config('request.jwt.claims', '{"sub":"5ec00000-0000-4000-8000-000000000004","role":"authenticated"}', true);
  perform public.register_push_token('5ec0e000-0000-4000-8000-00000000000b', 'resident', 'ExponentPushToken[sec-shared]');
  execute 'reset role';
  select count(*) into n_a from public.push_tokens
   where expo_push_token = 'ExponentPushToken[sec-shared]' and membership_id = '5ec0b000-0000-4000-8000-000000000001';
  select count(*) into n_b from public.push_tokens
   where expo_push_token = 'ExponentPushToken[sec-shared]' and membership_id = '5ec0b000-0000-4000-8000-000000000004';
  perform pg_temp.ok('the next person to register a phone takes its token from the last one', n_a = 0 and n_b = 1,
    'previous=' || n_a || ' new=' || n_b);
end $$;

-- ─── 9. Nothing in public executable by PUBLIC or anon that should not be ───

select pg_temp.ok('no SECURITY DEFINER function in public is executable by anon',
  count(*) = 0, string_agg(p.proname, ', '))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

select pg_temp.ok('freeze_agency_stamp is not executable by clients',
  not has_function_privilege('authenticated', 'public.freeze_agency_stamp()', 'execute')
  and not has_function_privilege('anon', 'public.freeze_agency_stamp()', 'execute'));

do $$
declare v_failed text;
begin
  select string_agg(name || coalesce(' [' || detail || ']', ''), E'\n  ') into v_failed from sec_results where not pass;
  if v_failed is not null then
    raise exception E'FAILED:\n  %', v_failed;
  end if;
end $$;

select name, pass, detail from sec_results order by seq;

-- Nothing above survives this, fixtures and migration splice included.
rollback;
