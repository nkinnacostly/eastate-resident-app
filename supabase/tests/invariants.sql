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
select seq, case when pass then 'PASS' else 'FAIL' end as status, name, detail from results order by seq;
