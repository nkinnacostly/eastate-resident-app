-- Estate Access Platform — self-service account deletion
--
-- Required by App Store Review Guideline 5.1.1(v) and Google Play's account
-- deletion policy: an app that lets people create an account must let them
-- delete it, in the app, without a support flow. Deactivating is explicitly not
-- enough.
--
-- What this deletes and what it deliberately keeps
-- ------------------------------------------------
-- Deleted: the profile (name, phone), every membership, every access code the
-- person ever minted, their join requests and rate-limit rows. The auth user
-- itself — and with it the email — is deleted by the delete-account Edge
-- Function, which holds the only key that can do it.
--
-- Kept: the estate's verification_events. Those rows are the gate's entry log:
-- who was admitted, when, by which guard. Letting a resident erase them would
-- let anyone wipe the evidence of who they signed in, which is the one thing an
-- access-control system exists to record. Instead the link to the person is cut
-- (code_id -> null) so the line survives with no route back to a deleted human.
-- Both stores allow retention for security purposes provided it is disclosed;
-- apps/site/delete-account.html discloses it.
--
-- Ordering matters: verification_events.code_id is a plain FK to access_codes
-- with no cascade, so the codes cannot be deleted until the events let go of
-- them. Reverse these two statements and deletion fails for any resident whose
-- code was ever used.

create or replace function public.delete_my_account()
returns table (status text, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_blocked      text;
  v_verifier_ids uuid[];
begin
  if v_uid is null then
    return query select 'not_authenticated'::text, null::text;
    return;
  end if;

  -- An estate with no administrator cannot approve residents, revoke codes or
  -- close itself down: it is unreachable. Refuse rather than strand it, and
  -- name the estate so the person knows what to hand over first.
  select string_agg(e.name, ', ')
    into v_blocked
    from public.memberships m
    join public.estates e on e.id = m.estate_id
   where m.user_id = v_uid
     and m.role = 'admin'
     and m.is_active
     and not exists (
       select 1
         from public.memberships other
        where other.estate_id = m.estate_id
          and other.role = 'admin'
          and other.is_active
          and other.user_id <> v_uid
     );

  if v_blocked is not null then
    return query select 'last_admin'::text, v_blocked;
    return;
  end if;

  -- A membership that has verified someone is named by an audit row we are
  -- keeping, and verification_events.verified_by_membership_id is NOT NULL, so
  -- that membership cannot be removed without destroying the log. Guards are
  -- provisioned by an estate admin and have no sign-up, so this is a safety net
  -- rather than a route anyone reaches from the resident app.
  select array_agg(distinct v.verified_by_membership_id)
    into v_verifier_ids
    from public.verification_events v
    join public.memberships m on m.id = v.verified_by_membership_id
   where m.user_id = v_uid;

  if v_verifier_ids is not null then
    return query select 'has_verified_entries'::text,
                        cardinality(v_verifier_ids)::text;
    return;
  end if;

  -- Cut the audit log loose from the codes before the codes go. The event keeps
  -- its estate, its timestamp, its outcome and the guard who recorded it.
  update public.verification_events v
     set code_id = null
   where v.code_id in (
     select c.id
       from public.access_codes c
       join public.memberships m on m.id = c.membership_id
      where m.user_id = v_uid
   );

  delete from public.access_codes c
   using public.memberships m
   where m.id = c.membership_id
     and m.user_id = v_uid;

  delete from public.join_requests j where j.user_id = v_uid;
  delete from public.memberships m  where m.user_id = v_uid;
  delete from public.profiles p     where p.id = v_uid;

  return query select 'deleted'::text, null::text;
end;
$$;

comment on function public.delete_my_account() is
  'Erases the calling user''s profile, memberships and codes. Identity comes '
  'from auth.uid(); there is deliberately no user-id parameter. The auth user '
  'is removed separately by the delete-account Edge Function.';

-- Definer-rights functions are EXECUTE-to-PUBLIC by default, which would make
-- this callable by anon.
revoke execute on function public.delete_my_account() from public, anon;
grant  execute on function public.delete_my_account() to authenticated;
