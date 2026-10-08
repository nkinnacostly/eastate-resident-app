-- Removes every fixture created by invariants.sql. Safe to run repeatedly.
delete from public.verification_events
 where estate_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
delete from public.access_codes
 where estate_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
delete from public.code_mint_attempts
 where membership_id::text like 'aaaaaaaa-%' or membership_id::text like 'bbbbbbbb-%';
delete from public.push_tokens
 where membership_id::text like 'aaaaaaaa-%' or membership_id::text like 'bbbbbbbb-%';
-- BEFORE memberships, not after. An approved join request carries
-- decided_by_membership_id, which references memberships with no ON DELETE
-- action -- so deleting the admin's membership while a decided request still
-- points at it fails with a foreign key violation and takes the whole teardown
-- with it. The estates delete below would cascade these away, but only if we
-- ever got that far.
delete from public.join_requests
 where estate_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');

delete from public.memberships
 where estate_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
delete from public.estates
 where id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
delete from public.platform_admins where user_id::text like '00000000-0000-4000-8000-%';
delete from public.profiles       where id::text      like '00000000-0000-4000-8000-%';
delete from auth.users            where id::text      like '00000000-0000-4000-8000-%';
-- Only this suite's messages; see invariants.sql. Memberships are gone by
-- now, so match their fixed ids directly.
delete from pgmq.q_notifications
 where message->>'estate_id' in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')
    or message->>'membership_id' like 'aaaaaaaa-0000-4000-8000-%'
    or message->>'membership_id' like 'bbbbbbbb-0000-4000-8000-%';
select 'torn down' as status,
       (select count(*) from auth.users where id::text like '00000000-0000-4000-8000-%') as users_left,
       (select count(*) from public.estates where id in
         ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')) as estates_left;
