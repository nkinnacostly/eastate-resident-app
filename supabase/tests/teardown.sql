-- Removes every fixture created by invariants.sql. Safe to run repeatedly.
delete from public.verification_events
 where estate_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
delete from public.access_codes
 where estate_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
delete from public.code_mint_attempts
 where membership_id::text like 'aaaaaaaa-%' or membership_id::text like 'bbbbbbbb-%';
delete from public.push_tokens
 where membership_id::text like 'aaaaaaaa-%' or membership_id::text like 'bbbbbbbb-%';
delete from public.memberships
 where estate_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
delete from public.estates
 where id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
delete from public.platform_admins where user_id::text like '00000000-0000-4000-8000-%';
delete from public.profiles       where id::text      like '00000000-0000-4000-8000-%';
delete from auth.users            where id::text      like '00000000-0000-4000-8000-%';
delete from pgmq.q_notifications;
select 'torn down' as status,
       (select count(*) from auth.users where id::text like '00000000-0000-4000-8000-%') as users_left,
       (select count(*) from public.estates where id in
         ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')) as estates_left;
