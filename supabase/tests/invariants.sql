-- Estate Access Platform — invariant test suite
--
-- Run against the LINKED project:
--     npm run test:db
--
-- Verifies the properties the design actually rests on — the 3-code cap,
-- one-time burn, replay dedupe, tenant isolation, the missing write path, and
-- the rate limiter counting rejected requests. Self-contained and rerunnable:
-- it recreates its own fixtures and clears prior test state each run.
--
-- Fixtures use deterministic uuids under 00000000-0000-4000-8000-% and the two
-- estates 1111…/2222…, so supabase/tests/teardown.sql removes exactly them.
--
-- NOTE ON METHOD: each RPC call runs in its OWN transaction. Calling
-- mint_access_code four times inside one SQL statement makes all four share a
-- command id, so the cap check cannot see the earlier inserts and every call
-- succeeds. That is a testing artifact, not a bug — but it will fool you.
--
-- Auth is simulated the way PostgREST does it:
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<uuid>", ...}';

-- Throwaway fixtures for invariant testing. Deterministic uuids so teardown is exact.
-- Users are inserted directly because the built-in SMTP is rate limited and
-- public signup sends a confirmation mail. Fine for a disposable test; NOT how
-- seed.sql or production should ever create users.

insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000001','owner@estate-qa.local','authenticated','authenticated','{"full_name":"Owner"}','now'),
  ('00000000-0000-4000-8000-000000000002','res-a@estate-qa.local','authenticated','authenticated','{"full_name":"Resident A"}','now'),
  ('00000000-0000-4000-8000-000000000003','grd-a@estate-qa.local','authenticated','authenticated','{"full_name":"Guard A"}','now'),
  ('00000000-0000-4000-8000-000000000004','res-b@estate-qa.local','authenticated','authenticated','{"full_name":"Resident B"}','now')
on conflict (id) do nothing;

insert into public.platform_admins (user_id)
values ('00000000-0000-4000-8000-000000000001')
on conflict (user_id) do nothing;

insert into public.estates (id, name)
values
  ('11111111-1111-4111-8111-111111111111','Estate A'),
  ('22222222-2222-4222-8222-222222222222','Estate B')
on conflict (id) do nothing;

insert into public.memberships (id, user_id, estate_id, role)
values
  ('aaaaaaaa-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','resident'),
  ('aaaaaaaa-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','guard'),
  ('bbbbbbbb-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','22222222-2222-4222-8222-222222222222','resident')
on conflict (user_id, estate_id, role) do nothing;

-- Did the on_auth_user_created trigger fire?
select
  (select count(*) from public.profiles
    where id::text like '00000000-0000-4000-8000-%') as profiles_autocreated,
  (select count(*) from public.memberships
    where estate_id in ('11111111-1111-4111-8111-111111111111',
                        '22222222-2222-4222-8222-222222222222')) as memberships;

create temp table results(seq int, name text, detail text, pass boolean);
grant all on results to authenticated;
create temp table minted(code text); grant all on minted to authenticated;
delete from public.verification_events where estate_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
delete from public.access_codes where estate_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
delete from public.code_mint_attempts where membership_id in ('aaaaaaaa-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000004');
update public.memberships set is_active=true, deactivated_at=null where id='aaaaaaaa-0000-4000-8000-000000000002';
delete from pgmq.q_notifications;
insert into public.memberships (id,user_id,estate_id,role) values ('aaaaaaaa-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','admin') on conflict (user_id,estate_id,role) do nothing;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into results select 100+1,'m','1='||r.result,true from public.mint_access_code('11111111-1111-4111-8111-111111111111') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into results select 100+2,'m','2='||r.result,true from public.mint_access_code('11111111-1111-4111-8111-111111111111') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into results select 100+3,'m','3='||r.result,true from public.mint_access_code('11111111-1111-4111-8111-111111111111') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into results select 100+4,'m','4='||r.result,true from public.mint_access_code('11111111-1111-4111-8111-111111111111') r;
commit;
insert into results select 1,'cap: 4 sequential mints as resident A',
  string_agg(split_part(detail,'=',2),',' order by seq),
  string_agg(split_part(detail,'=',2),',' order by seq)='ok,ok,ok,code_limit_reached'
  from results where seq between 101 and 104;
delete from results where seq between 101 and 104;
insert into minted select code from public.access_codes where estate_id='11111111-1111-4111-8111-111111111111' and status='active' order by created_at limit 1;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+1,'r','1='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+2,'r','2='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+3,'r','3='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+4,'r','4='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+5,'r','5='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+6,'r','6='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+7,'r','7='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+8,'r','8='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+9,'r','9='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+10,'r','10='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 200+11,'r','11='||r.result,true from public.mint_access_code('22222222-2222-4222-8222-222222222222') r;
commit;
insert into results select 8,'rate limit: counter survives rejected mints',
  'call11='||max(case when seq=211 then split_part(detail,'=',2) end)
   ||' limited='||count(*) filter (where split_part(detail,'=',2)='rate_limited')::text,
  max(case when seq=211 then split_part(detail,'=',2) end)='rate_limited'
  from results where seq between 201 and 211;
delete from results where seq between 201 and 211;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into results select 2,'burn: first verification admits', v.outcome::text, v.outcome='admitted'
  from public.verify_access_code('11111111-1111-4111-8111-111111111111',(select code from minted),'eeeeeeee-0000-4000-8000-000000000001') v;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into results select 3,'double-burn: new event id on a used code is a collision',
  v.outcome::text||'/'||v.collision::text, v.outcome='collision' and v.collision
  from public.verify_access_code('11111111-1111-4111-8111-111111111111',(select code from minted),'eeeeeeee-0000-4000-8000-000000000002') v;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into results select 4,'replay: same client_event_id returns the STORED verdict',
  v.outcome::text||'/'||v.collision::text, v.outcome='admitted' and not v.collision
  from public.verify_access_code('11111111-1111-4111-8111-111111111111',(select code from minted),'eeeeeeee-0000-4000-8000-000000000001') v;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into results select 5,'reject: unknown code recorded, not dropped',
  v.outcome::text||'/'||coalesce(v.reject_reason::text,'null')||'/code_id='||coalesce(v.code_id::text,'null'),
  v.outcome='rejected' and v.reject_reason='unknown_code' and v.code_id is null
  from public.verify_access_code('11111111-1111-4111-8111-111111111111','ZZZZZZ','eeeeeeee-0000-4000-8000-000000000003') v;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 6,'RLS: resident B sees zero estate-A codes','visible='||count(*)::text,count(*)=0
  from public.access_codes where estate_id='11111111-1111-4111-8111-111111111111';
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$ declare v_msg text; v_ok boolean:=false;
begin
  begin update public.access_codes set status='used' where estate_id='11111111-1111-4111-8111-111111111111';
    v_msg:='UPDATE SUCCEEDED - write path open';
  exception when others then v_msg:=sqlstate||' '||sqlerrm; v_ok:=true; end;
  insert into results values (7,'RLS: direct UPDATE on access_codes refused',v_msg,v_ok);
end $$;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}';
insert into results select 11,'RLS: resident B cannot read estate-A verification_events','visible='||count(*)::text,count(*)=0
  from public.verification_events where estate_id='11111111-1111-4111-8111-111111111111';
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.deactivate_membership('aaaaaaaa-0000-4000-8000-000000000002');
commit;
insert into results select 9,'deactivation: outstanding codes revoked',
  'active='||count(*) filter (where status='active')::text||' revoked='||count(*) filter (where status='revoked')::text,
  count(*) filter (where status='active')=0 and count(*) filter (where status='revoked')>=1
  from public.access_codes where membership_id='aaaaaaaa-0000-4000-8000-000000000002';
insert into results select 10,'queue: code_used + forced_pull enqueued',
  'code_used='||count(*) filter (where message->>'kind'='code_used')::text||' forced_pull='||count(*) filter (where message->>'kind'='forced_pull')::text,
  count(*) filter (where message->>'kind'='code_used')>=1 and count(*) filter (where message->>'kind'='forced_pull')>=1
  from pgmq.q_notifications;
-- The admit-and-flag override, both directions.
--
-- These are a pair on purpose. 12 proves the override now survives the replay;
-- 13 proves adding it did not turn ordinary unknown-code rejections into
-- admissions. One without the other would let a fix that admits EVERYTHING
-- pass, which is the worse failure of the two -- it would open the gate.
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into results select 12,'flagged: guard override replays as admitted, not rejected',
  v.outcome::text||'/without_match='||v.admitted_without_match::text,
  v.outcome='admitted' and v.admitted_without_match
  from public.ingest_verification_events('11111111-1111-4111-8111-111111111111',
    '[{"client_event_id":"eeeeeeee-0000-4000-8000-000000000010","code_id":null,"code":"QQQQQQ","verified_at":"2026-09-23T10:00:00Z","pool_age_seconds":900,"flagged":true}]'::jsonb) v;
commit;
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into results select 13,'flagged: an unflagged unknown code is still refused',
  v.outcome::text||'/'||coalesce(v.reject_reason::text,'null')||'/without_match='||v.admitted_without_match::text,
  v.outcome='rejected' and v.reject_reason='unknown_code' and not v.admitted_without_match
  from public.ingest_verification_events('11111111-1111-4111-8111-111111111111',
    '[{"client_event_id":"eeeeeeee-0000-4000-8000-000000000011","code_id":null,"code":"QQQQQQ","verified_at":"2026-09-23T10:00:00Z","pool_age_seconds":900}]'::jsonb) v;
commit;
-- ─── bulk house import ───────────────────────────────────────────────────────
--
-- The property that matters is IDEMPOTENCE. An admin exports the roll, imports
-- it, spots three missing houses, and imports the whole file again — that is
-- the normal way this is used. A second import must not create a second house
-- at the same number, and above all must not ROTATE the code, because the
-- first one has already been printed on a letter and posted.
-- Rerunnable, like every other fixture here: the previous run created these,
-- and test 14 asserts on CREATED counts, so leaving them behind turns a green
-- suite red on its second run for no reason.
delete from public.houses
 where estate_id = '11111111-1111-4111-8111-111111111111'
   and house_number like 'QA-%';

begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into results select 14,'bulk import: creates houses and reports each row',
  'created='||count(*) filter (where b.status='created')::text
   ||' invalid='||count(*) filter (where b.status='invalid')::text,
  count(*) filter (where b.status='created')=3
  and count(*) filter (where b.status='invalid')=1
  from public.create_houses_bulk('11111111-1111-4111-8111-111111111111',
    '[{"house_number":"QA-1"},{"house_number":"QA-2","landlord_name":"Owner Two"},
      {"house_number":"QA-3"},{"house_number":"   "}]'::jsonb) b;
commit;

begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into results select 15,'bulk import: re-importing skips and keeps the SAME code',
  'dupes='||count(*) filter (where b.status='duplicate')::text
   ||' codes_match='||count(*) filter (where b.house_code = h.house_code)::text,
  count(*) filter (where b.status='duplicate')=3
  and count(*) filter (where b.house_code = h.house_code)=3
  from public.create_houses_bulk('11111111-1111-4111-8111-111111111111',
    '[{"house_number":"QA-1"},{"house_number":"QA-2"},{"house_number":"QA-3"}]'::jsonb) b
  join public.houses h
    on h.estate_id = '11111111-1111-4111-8111-111111111111'
   and h.house_number = b.house_number;
commit;

insert into results select 16,'bulk import: one row per house, not two',
  'rows='||count(*)::text, count(*)=3
  from public.houses
 where estate_id='11111111-1111-4111-8111-111111111111' and house_number like 'QA-%';

-- A resident is not an admin. The batch is refused outright rather than
-- partially applied, because the estate is a parameter of the CALL.
begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ declare v_msg text; v_ok boolean:=false;
begin
  begin
    perform public.create_houses_bulk('11111111-1111-4111-8111-111111111111',
      '[{"house_number":"SNEAK-1"}]'::jsonb);
    v_msg:='IMPORT SUCCEEDED AS A RESIDENT';
  exception when others then v_msg:=sqlstate||' '||sqlerrm; v_ok:=true; end;
  insert into results values (17,'bulk import: refused to a non-admin',v_msg,v_ok);
end $$;
commit;

-- ─── bulk approve ────────────────────────────────────────────────────────────
--
-- Two requests, one at each estate, approved in ONE call by an admin who
-- administers only estate A. The estate-A request must go through and the
-- estate-B request must not — the whole reason the bulk function loops over
-- approve_join_request instead of reimplementing its authority check.
--
-- A DEDICATED ADMIN, because the obvious candidate does not work. User 001 is
-- an estate-A admin AND a platform admin, and approve_join_request lets a
-- platform admin approve at ANY estate on purpose. Running this as 001
-- approves both requests and passes nothing — it measures the escape hatch
-- rather than the boundary. 005 administers estate A and nothing else.
insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
values ('00000000-0000-4000-8000-000000000005','adm-a@estate-qa.local','authenticated',
        'authenticated','{"full_name":"Admin A"}','now')
on conflict (id) do nothing;

insert into public.memberships (id, user_id, estate_id, role)
values ('aaaaaaaa-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000005',
        '11111111-1111-4111-8111-111111111111','admin')
on conflict (user_id, estate_id, role) do nothing;

-- Rerunnable: a previous run approved these, so clear the memberships they
-- created or the "no membership leaked" check reads last run's result.
delete from public.memberships
 where user_id = '00000000-0000-4000-8000-000000000003' and role = 'resident';

insert into public.join_requests (id, user_id, estate_id, status)
values
  ('dddddddd-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003',
   '11111111-1111-4111-8111-111111111111','pending'),
  ('dddddddd-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',
   '22222222-2222-4222-8222-222222222222','pending')
on conflict (id) do update set status='pending', decided_at=null;

begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}';
insert into results select 18,'bulk approve: approves own estate, refuses another''s',
  'approved='||count(*) filter (where b.status='approved')::text
   ||' failed='||count(*) filter (where b.status='failed')::text,
  count(*) filter (where b.status='approved')=1
  and count(*) filter (where b.status='failed')=1
  from public.approve_join_requests_bulk(array[
    'dddddddd-0000-4000-8000-000000000001'::uuid,
    'dddddddd-0000-4000-8000-000000000002'::uuid]) b;
commit;

-- The failure above must be a REFUSAL, not a cosmetic status: estate B's
-- request has to still be pending, and no membership may exist at estate B.
insert into results select 19,'bulk approve: the refused request was not decided',
  'status='||status::text, status='pending'
  from public.join_requests where id='dddddddd-0000-4000-8000-000000000002';

insert into results select 20,'bulk approve: no membership leaked into estate B',
  'memberships='||count(*)::text, count(*)=0
  from public.memberships
 where estate_id='22222222-2222-4222-8222-222222222222'
   and user_id='00000000-0000-4000-8000-000000000003';

select seq, case when pass then 'PASS' else 'FAIL' end as status, name, detail from results order by seq;
