-- A resident who paid a house's levy could not delete their account.
--
-- delete_my_account (20260821090000) deletes the caller's memberships, and the
-- delete-account Edge Function reports any failure as scrub_failed. Most rows
-- that name a membership cascade with it. These did not: they record WHO did
-- something (paid, revoked, decided, waived, sent a reminder, changed the
-- payout account) with a plain foreign key and no ON DELETE rule, so the
-- delete was refused. The common case is a tenant who paid the house's levy
-- through the app: dues_payments keeps the payment (it belongs to the house's
-- charge, not to the tenant) and initiated_by_membership_id still pointed at
-- the tenant. Deleting your account is a right under POPIA and the NDPA, and
-- the app offers it; it must work.
--
-- Each of these now becomes NULL when the membership goes. The record stays
-- -- the payment, the revocation, the decision -- and only the pointer to a
-- person who has asked to be erased is removed, which is what erasure means.
-- (dues_payments keeps payer_email by design: it is the receipt address for
-- a payment the HOA received, the same as a pay-by-link payment with no account.)
--
-- verification_events.verified_by_membership_id is deliberately NOT changed:
-- the gate log names the guard who checked a code, and delete_my_account
-- refuses (has_verified_entries) rather than strip it.
--
-- ALTER TABLE IF EXISTS so the local test harness, which models only some of
-- these tables, replays this file unchanged.

alter table if exists public.dues_payments
  drop constraint if exists dues_payments_initiated_by_membership_id_fkey,
  add  constraint dues_payments_initiated_by_membership_id_fkey
       foreign key (initiated_by_membership_id) references public.memberships (id) on delete set null;

alter table if exists public.access_codes
  drop constraint if exists access_codes_revoked_by_membership_id_fkey,
  add  constraint access_codes_revoked_by_membership_id_fkey
       foreign key (revoked_by_membership_id) references public.memberships (id) on delete set null,
  drop constraint if exists access_codes_verified_by_membership_id_fkey,
  add  constraint access_codes_verified_by_membership_id_fkey
       foreign key (verified_by_membership_id) references public.memberships (id) on delete set null;

alter table if exists public.join_requests
  drop constraint if exists join_requests_decided_by_membership_id_fkey,
  add  constraint join_requests_decided_by_membership_id_fkey
       foreign key (decided_by_membership_id) references public.memberships (id) on delete set null;

alter table if exists public.dues_charges
  drop constraint if exists dues_charges_waived_by_membership_id_fkey,
  add  constraint dues_charges_waived_by_membership_id_fkey
       foreign key (waived_by_membership_id) references public.memberships (id) on delete set null;

alter table if exists public.dues_reminders
  drop constraint if exists dues_reminders_sent_by_membership_id_fkey,
  add  constraint dues_reminders_sent_by_membership_id_fkey
       foreign key (sent_by_membership_id) references public.memberships (id) on delete set null;

alter table if exists public.estate_settlement_changes
  drop constraint if exists estate_settlement_changes_changed_by_membership_id_fkey,
  add  constraint estate_settlement_changes_changed_by_membership_id_fkey
       foreign key (changed_by_membership_id) references public.memberships (id) on delete set null;
