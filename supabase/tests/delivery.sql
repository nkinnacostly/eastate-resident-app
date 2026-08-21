-- Estate Access Platform — delivery-code invariants
--
-- Run against the LINKED project:
--     npm run test:db:delivery
--
-- Covers the properties the delivery feature rests on: the note is only ever
-- stored on a code the resident actually marked as a delivery, it is bounded,
-- whitespace is not a note, an over-long note costs the resident a code but
-- still advances the rate limiter, and none of it opened a client write path.
--
-- Uses the SAME deterministic fixtures as invariants.sql, so
-- supabase/tests/teardown.sql removes these rows too.
--
-- NOTE ON METHOD: every RPC call gets its OWN transaction. Several calls inside
-- one statement share a command id, so the cap check cannot see earlier inserts
-- and every call falsely succeeds. Same trap as invariants.sql.

insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
values
  ('00000000-0000-4000-8000-000000000002','res-a@estate-qa.local','authenticated','authenticated','{"full_name":"Resident A"}','now')
on conflict (id) do nothing;

insert into public.estates (id, name)
values ('11111111-1111-4111-8111-111111111111','Estate A')
on conflict (id) do nothing;

insert into public.memberships (id, user_id, estate_id, role)
values ('aaaaaaaa-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','resident')
on conflict (user_id, estate_id, role) do nothing;

create temp table results(seq int, name text, detail text, pass boolean);
grant all on results to authenticated;

-- Clean slate: the cap is three, and these tests mint repeatedly.
delete from public.verification_events where estate_id = '11111111-1111-4111-8111-111111111111';
delete from public.access_codes         where estate_id = '11111111-1111-4111-8111-111111111111';
delete from public.code_mint_attempts   where membership_id = 'aaaaaaaa-0000-4000-8000-000000000002';

-- ── 1. A plain code carries no delivery state ────────────────────────────────

begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into results select 1,'plain mint: is_delivery=false, note null',
  'result=' || r.result, r.result = 'ok'
  from public.mint_access_code('11111111-1111-4111-8111-111111111111') r;
commit;

insert into results select 2,'plain code stored without delivery fields',
  'is_delivery=' || ac.is_delivery || ' note=' || coalesce(ac.delivery_note,'<null>'),
  ac.is_delivery = false and ac.delivery_note is null
  from public.access_codes ac
 where ac.estate_id='11111111-1111-4111-8111-111111111111'
 order by ac.sync_seq desc limit 1;

-- ── 2. A delivery code keeps its instructions verbatim ───────────────────────

begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into results select 3,'delivery mint accepted',
  'result=' || r.result, r.result = 'ok'
  from public.mint_access_code('11111111-1111-4111-8111-111111111111', true, 'Leave at the gate, house 14') r;
commit;

insert into results select 4,'note stored verbatim',
  'is_delivery=' || ac.is_delivery || ' note=' || coalesce(ac.delivery_note,'<null>'),
  ac.is_delivery = true and ac.delivery_note = 'Leave at the gate, house 14'
  from public.access_codes ac
 where ac.estate_id='11111111-1111-4111-8111-111111111111'
 order by ac.sync_seq desc limit 1;

-- ── 3. Whitespace is not a note ──────────────────────────────────────────────
-- A resident who taps through the sheet without typing gets a delivery code,
-- not a code whose share message ends in "Delivery instructions:    ".

begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into results select 5,'whitespace-only note accepted as no note',
  'result=' || r.result, r.result = 'ok'
  from public.mint_access_code('11111111-1111-4111-8111-111111111111', true, '     ') r;
commit;

insert into results select 6,'whitespace stored as null, delivery flag kept',
  'is_delivery=' || ac.is_delivery || ' note=' || coalesce(ac.delivery_note,'<null>'),
  ac.is_delivery = true and ac.delivery_note is null
  from public.access_codes ac
 where ac.estate_id='11111111-1111-4111-8111-111111111111'
 order by ac.sync_seq desc limit 1;

-- ── 4. A note without the flag is dropped, never honoured ────────────────────
-- Our own client cannot send this; a hand-rolled RPC call can. Storing it would
-- put instructions in the share message of a code never marked as a delivery.
-- (Cap is full at this point, so clear it first.)

delete from public.access_codes where estate_id='11111111-1111-4111-8111-111111111111';

begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into results select 7,'note without is_delivery is dropped',
  'result=' || r.result, r.result = 'ok'
  from public.mint_access_code('11111111-1111-4111-8111-111111111111', false, 'sneaky instructions') r;
commit;

insert into results select 8,'…and the row holds no note',
  'is_delivery=' || ac.is_delivery || ' note=' || coalesce(ac.delivery_note,'<null>'),
  ac.is_delivery = false and ac.delivery_note is null
  from public.access_codes ac
 where ac.estate_id='11111111-1111-4111-8111-111111111111'
 order by ac.sync_seq desc limit 1;

-- ── 5. Over-long notes are rejected, not truncated ───────────────────────────

begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into results select 9,'201-char note rejected',
  'result=' || r.result, r.result = 'note_too_long'
  from public.mint_access_code('11111111-1111-4111-8111-111111111111', true, repeat('x', 201)) r;
commit;

begin; set local role authenticated; set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}';
insert into results select 10,'exactly 200 chars is accepted (boundary)',
  'result=' || r.result, r.result = 'ok'
  from public.mint_access_code('11111111-1111-4111-8111-111111111111', true, repeat('y', 200)) r;
commit;

insert into results select 16,'200-char note stored whole, not truncated',
  'len=' || coalesce(char_length(ac.delivery_note), -1),
  ac.is_delivery = true and char_length(ac.delivery_note) = 200
  from public.access_codes ac
 where ac.estate_id='11111111-1111-4111-8111-111111111111'
 order by ac.sync_seq desc limit 1;

-- ── 6. The rate limiter counted the rejected request ─────────────────────────
-- The reason the note check sits AFTER the counter. If it sat before, a client
-- looping on bad input would never advance the limiter — the same inversion the
-- no-RAISE rule exists to prevent.

insert into results select 11,'rejected note still advanced the rate limiter',
  'hits=' || coalesce(sum(hits),0),
  coalesce(sum(hits),0) >= 6
  from public.code_mint_attempts
 where membership_id = 'aaaaaaaa-0000-4000-8000-000000000002';

-- ── 7. The CHECK constraint holds independently of the function ──────────────
-- Defence in depth: a future write path that forgets to validate still cannot
-- store a note on a non-delivery code.

do $$
begin
  begin
    insert into public.access_codes (code, estate_id, membership_id, status, expires_at, is_delivery, delivery_note)
    values ('ZZZZZ9','11111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000002','active', now() + interval '1 hour', false, 'note on a non-delivery');
    insert into results values (12,'CHECK rejects note without is_delivery','INSERT SUCCEEDED', false);
  exception when check_violation then
    insert into results values (12,'CHECK rejects note without is_delivery','check_violation', true);
  end;
end $$;

do $$
begin
  begin
    insert into public.access_codes (code, estate_id, membership_id, status, expires_at, is_delivery, delivery_note)
    values ('ZZZZZ8','11111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000002','active', now() + interval '1 hour', true, repeat('z', 201));
    insert into results values (13,'CHECK rejects an over-long note','INSERT SUCCEEDED', false);
  exception when check_violation then
    insert into results values (13,'CHECK rejects an over-long note','check_violation', true);
  end;
end $$;

-- ── 8. No client write path was opened ───────────────────────────────────────
-- access_codes still has SELECT-only policies. Adding columns must not have
-- changed that.

do $$
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
    update public.access_codes set delivery_note = 'client edit'
     where estate_id='11111111-1111-4111-8111-111111111111';
    if found then
      insert into results values (14,'resident cannot UPDATE delivery_note','UPDATE AFFECTED ROWS', false);
    else
      insert into results values (14,'resident cannot UPDATE delivery_note','0 rows (RLS)', true);
    end if;
  exception when insufficient_privilege then
    insert into results values (14,'resident cannot UPDATE delivery_note','insufficient_privilege', true);
  end;
  reset role;
end $$;

-- ── 9. The RPC is not anon-callable ──────────────────────────────────────────

do $$
begin
  begin
    set local role anon;
    perform public.mint_access_code('11111111-1111-4111-8111-111111111111', true, 'anon');
    insert into results values (15,'anon cannot call mint_access_code','CALL SUCCEEDED', false);
  exception when insufficient_privilege then
    insert into results values (15,'anon cannot call mint_access_code','insufficient_privilege', true);
  end;
  reset role;
end $$;

select seq, case when pass then 'PASS' else 'FAIL' end as status, name, detail
  from results order by seq;
