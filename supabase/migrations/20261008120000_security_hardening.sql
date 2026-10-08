-- Security hardening from the October 2026 audit.
--
-- Each section names the attack it closes. supabase/tests/security.sql proves
-- every one of them against the live schema, as the real roles, and was shown
-- to fail on the schema before this migration.

-- ─── 1. Privileges row-level security cannot see ────────────────────────────
--
-- TRUNCATE ignores RLS entirely: it empties a table without consulting a
-- single policy. anon and authenticated held it (with REFERENCES and TRIGGER)
-- on most tables, left over from the platform's default grants. PostgREST
-- has no way to issue it today, so this is not a live hole — it is a loaded
-- one, one SECURITY INVOKER function with dynamic SQL away from wiping
-- access_codes. Nothing in this project needs any of the three.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- And stop granting them, or anything else, to tables created from here on.
-- Every table in this project grants exactly what its clients need in its own
-- migration; a default that grants more is how dues_payments' column
-- restriction (below) came to depend on which environment it ran in.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- ─── 2. The estate's bank account, readable by every resident and guard ─────
--
-- A table-level SELECT on estates plus "members read their own estate" let
-- any resident or guard run
--   from('estates').select('settlement_account_number, ...')
-- and read the full account number that estate_settlement() goes out of its
-- way to mask even for the admin. Column grants, not a policy: RLS decides
-- which ROWS, never which columns. Clients read only these; the settlement
-- columns are reached through estate_settlement() and the operator RPCs, which
-- are SECURITY DEFINER and unaffected.
--
-- (Revoking the table privilege also revokes every column privilege of the
-- same kind, so this is a clean slate before the grant.)
revoke select on public.estates from authenticated;
grant select (
  id, name, address, contact_info, is_active, created_at, join_code,
  dues_billing_mode, dues_amount_minor, dues_currency, dues_grace_days,
  dues_enforcement_authorised_at, dues_enforcement_basis
) on public.estates to authenticated;

-- ─── 3. dues_payments: the column restriction, made unconditional ───────────
--
-- 20260927120000 granted SELECT on the safe columns but never revoked the
-- table first. It holds in production only because this project's defaults
-- happen not to grant SELECT on new tables; on a standard Supabase stack (a
-- branch, a restore, `db reset`) the table-level grant would override it and
-- every resident of a house could read co-payers' card tokens (raw_payload)
-- and emails. Same columns as today, now independent of the environment.
revoke all on public.dues_payments from anon, authenticated;
grant select (
  id, charge_id, tx_ref, provider, amount_minor, currency, status,
  initiated_by_membership_id, created_at, settled_at
) on public.dues_payments to authenticated;

-- ─── 4. A deactivated membership kept its own-row access ────────────────────
--
-- These three policies matched "a membership of mine" without asking whether
-- it was still active: a moved-out resident kept reading their old codes, a
-- dismissed guard the gate events they logged, and either could keep
-- registering push tokens against a membership that no longer exists in any
-- meaningful sense.

drop policy "access_codes: residents read their own, admins read the estate's" on public.access_codes;
create policy "access_codes: residents read their own, admins read the estate's"
  on public.access_codes for select to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.id = access_codes.membership_id
         and m.user_id = (select auth.uid())
         and m.is_active
    )
    or public.has_membership(estate_id, 'admin')
  );

drop policy "verification_events: admins read the estate's, guards read their own" on public.verification_events;
create policy "verification_events: admins read the estate's, guards read their own"
  on public.verification_events for select to authenticated
  using (
    public.has_membership(estate_id, 'admin')
    or exists (
      select 1 from public.memberships m
       where m.id = verification_events.verified_by_membership_id
         and m.user_id = (select auth.uid())
         and m.is_active
    )
  );

drop policy "push_tokens: manage own" on public.push_tokens;
create policy "push_tokens: manage own"
  on public.push_tokens for all to authenticated
  using (
    exists (
      select 1 from public.memberships m
       where m.id = push_tokens.membership_id
         and m.user_id = (select auth.uid())
    )
  )
  -- USING stays open to an inactive membership on purpose: a person signing
  -- out of a phone after they moved out must still be able to delete their
  -- own token. Only CREATING or repointing one needs a live membership.
  with check (
    exists (
      select 1 from public.memberships m
       where m.id = push_tokens.membership_id
         and m.user_id = (select auth.uid())
         and m.is_active
    )
  );

-- ─── 5. Confirmed is not the same as proved ─────────────────────────────────
--
-- Landlord access is "your confirmed email equals houses.landlord_email". But
-- onboard-guard creates accounts with email_confirm: true and hands the
-- password to the estate admin who typed the address. So any estate admin
-- could create an account on a landlord's email and read that landlord's
-- houses, house codes, dues and payments at every OTHER estate.
--
-- Admin-created accounts now carry app_metadata.email_unproven (the user
-- cannot write app_metadata), and that flag is not an identity until the
-- owner shows they hold the inbox: prove_email_ownership(), called from a
-- session that was opened with a code emailed to that address.

create or replace function public.current_verified_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(u.email))
    from auth.users u
   where u.id = (select auth.uid())
     -- The whole basis of landlord access. An unconfirmed address is a claim,
     -- not an identity.
     and u.email_confirmed_at is not null
     and coalesce(btrim(u.email), '') <> ''
     -- Nor is an address someone ELSE confirmed on this person's behalf.
     and coalesce((u.raw_app_meta_data ->> 'email_unproven')::boolean, false) = false;
$$;

create function public.prove_email_ownership()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- amr lists how THIS session was established. Every method here means a
  -- code or link sent to the account's address was redeemed; a password, the
  -- thing an estate admin was handed, is deliberately not among them.
  if not exists (
    select 1
      from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) a
     where a ->> 'method' in ('otp', 'recovery', 'magiclink', 'email/signup', 'email_change', 'invite')
  ) then
    return false;
  end if;

  update auth.users
     set raw_app_meta_data = raw_app_meta_data - 'email_unproven'
   where id = (select auth.uid());
  return true;
end;
$$;
revoke execute on function public.prove_email_ownership() from public, anon;
grant  execute on function public.prove_email_ownership() to authenticated;

-- Accounts already created this way: confirmed without ever being sent a
-- confirmation. The platform operators are left alone — they are the people
-- this check protects the platform FOR, and they created their own accounts.
update auth.users u
   set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || '{"email_unproven": true}'::jsonb
 where u.confirmation_sent_at is null
   and u.email_confirmed_at is not null
   and not exists (select 1 from public.platform_admins p where p.user_id = u.id);

-- ─── 6. raise_current_dues billed every estate on the platform ──────────────
--
-- It called the monthly run, which has no estate filter: any estate admin
-- raising this month's dues for their own estate also raised a charge for
-- every house and resident added since the 1st IN EVERY OTHER ESTATE — due a
-- grace period after the 1st, usually already past, so straight into arrears
-- and, where enforcement is on, refused visitor codes. The body below is the
-- monthly run verbatim with an estate filter and a due-date floor added; the
-- monthly run is now a wrapper around it with both left null, so the two
-- still cannot disagree about who is billable.

create function public._generate_dues_charges(
  p_period    date,
  p_estate_id uuid,   -- null: every estate (the monthly run)
  p_due_floor date    -- null: due a grace period after the 1st, as always
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', p_period::timestamptz)::date;
  v_count  integer := 0;
  v_added  integer;
begin
  -- 1. Houses the landlord pays for: one charge against the house.
  insert into public.dues_charges
    (estate_id, period, house_id, amount_minor, currency, due_on)
  select h.estate_id, v_period, h.id, t.amount_minor, t.currency,
         greatest(v_period, coalesce(p_due_floor, v_period)) + t.grace_days
    from public.houses h
    join public.estates e on e.id = h.estate_id and e.is_active
    -- house_dues_terms returns NO ROW for an estate that does not bill, so a
    -- lateral join is also the filter: a house in a switched-off estate simply
    -- disappears from this query rather than needing a separate guard.
    cross join lateral public.house_dues_terms(h.id) t
   where h.is_active
     and (p_estate_id is null or h.estate_id = p_estate_id)
     and t.payer = 'landlord'
     and t.amount_minor is not null
  -- Re-running the month is a no-op rather than a double-bill. That property
  -- is what makes this safe to invoke by hand after a failed cron.
  on conflict do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  -- 2. Houses the residents pay for: one charge EACH, at the house's rate.
  --    Per resident, not a total split between them -- see the note at the top
  --    of this file on why splitting would rewrite everyone's bill whenever a
  --    housemate moved in or out.
  insert into public.dues_charges
    (estate_id, period, membership_id, amount_minor, currency, due_on)
  select h.estate_id, v_period, m.id, t.amount_minor, t.currency,
         greatest(v_period, coalesce(p_due_floor, v_period)) + t.grace_days
    from public.houses h
    join public.estates e on e.id = h.estate_id and e.is_active
    cross join lateral public.house_dues_terms(h.id) t
    join public.memberships m
      on m.house_id = h.id and m.role = 'resident' and m.is_active
   where h.is_active
     and (p_estate_id is null or h.estate_id = p_estate_id)
     and t.payer = 'residents'
     and t.amount_minor is not null
  on conflict do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  -- 3. Residents with no house on record, in an estate that bills residents.
  --    They have no house whose terms could apply, so the estate's own figure
  --    is the only one there is.
  insert into public.dues_charges
    (estate_id, period, membership_id, amount_minor, currency, due_on)
  select e.id, v_period, m.id, e.dues_amount_minor, e.dues_currency,
         greatest(v_period, coalesce(p_due_floor, v_period)) + e.dues_grace_days
    from public.estates e
    join public.memberships m
      on m.estate_id = e.id and m.role = 'resident' and m.is_active
     and m.house_id is null
   where e.dues_billing_mode = 'per_resident'
     and (p_estate_id is null or e.id = p_estate_id)
     and e.is_active
  on conflict do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  return v_count;
end;
$$;revoke execute on function public._generate_dues_charges(date, uuid, date) from public, anon, authenticated;

create or replace function public.generate_dues_charges(
  p_period date default date_trunc('month', current_date)::date
)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select public._generate_dues_charges(p_period, null, null);
$$;
revoke execute on function public.generate_dues_charges(date) from public, anon, authenticated;

create or replace function public.raise_current_dues(p_estate_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.current_membership(p_estate_id, 'admin');
begin
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  -- This estate only, and due a full grace period from TODAY: a charge raised
  -- on the 20th is not already three weeks overdue.
  return public._generate_dues_charges(
    date_trunc('month', current_date)::date, p_estate_id, current_date);
end;
$$;

-- ─── 7. Callers chose their own revocation reason ───────────────────────────

create or replace function public.revoke_access_code(
  p_code_id uuid,
  p_reason  text default null
)
returns table (result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code    public.access_codes;
  v_admin   uuid;
  v_actor   uuid;
  v_reason  public.revoked_reason;
  v_updated integer;
begin
  select * into v_code from public.access_codes where id = p_code_id;
  if v_code.id is null then
    return query select 'not_found'::text;
    return;
  end if;

  v_admin := public.current_membership(v_code.estate_id, 'admin');

  if v_admin is not null then
    v_actor  := v_admin;
    v_reason := 'admin_revoked';
  elsif v_code.membership_id = public.current_membership(v_code.estate_id, 'resident') then
    v_actor  := v_code.membership_id;
    v_reason := 'resident_cancelled';
  else
    -- Not found rather than forbidden: a stranger must not be able to probe
    -- which code ids exist.
    return query select 'not_found'::text;
    return;
  end if;

  update public.access_codes
     set status                   = 'revoked',
         revoked_at               = now(),
         revoked_by_membership_id = v_actor,
         -- Derived from WHO is revoking, never taken from the caller: p_reason
         -- used to be cast straight to the enum, so a resident could file
         -- their own cancellation as 'admin_revoked' and an admin could file
         -- theirs as 'resident_cancelled'. Kept as a parameter so existing
         -- callers do not break; it is ignored.
         revoked_reason           = v_reason
   where id = p_code_id
     and status = 'active'
     and swept_at is null;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return query select case v_code.status
                          when 'used'    then 'already_used'
                          when 'revoked' then 'already_revoked'
                          else 'not_found'
                        end::text;
    return;
  end if;

  return query select 'ok'::text;
end;
$$;
-- ─── 8. An offline replay could attach another estate's code to an event ────

create or replace function public._ingest_verification_event(
  p_client_event_id uuid,
  p_membership_id   uuid,          -- the verifying guard, ALREADY VERIFIED
  p_estate_id       uuid,
  p_code_id         uuid,          -- offline callers pass this...
  p_code            text,          -- ...online callers pass this
  p_verified_at     timestamptz,
  p_source          public.event_source,
  p_pool_age        integer,
  -- The gate's claim that the guard overrode a refusal. Defaulted so the
  -- online path (verify_access_code) keeps calling with 8 arguments: an
  -- override is only ever something a guard does to a LOCAL verdict, and
  -- there is no override of a server refusal by design — that would be
  -- admitting a code the server authoritatively refused.
  p_flagged         boolean default false
)
returns public.verification_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event    public.verification_events;
  v_code_id  uuid := p_code_id;
  v_burned   uuid;
  v_owner    uuid;
  v_code_str text;
  v_outcome  public.event_outcome;
  v_reason   public.reject_reason;
  v_collide  boolean;
  v_status   public.code_status;
  v_flagged  boolean := coalesce(p_flagged, false);
begin
  -- An offline replay names its code by id. An id from ANOTHER estate could
  -- never burn here (the burn below is estate-scoped), but the event row would
  -- keep it, and this estate's admin would then read another estate's
  -- resident and house through that join. Resolve only within this estate.
  if v_code_id is not null and not exists (
    select 1 from public.access_codes ac
     where ac.id = v_code_id and ac.estate_id = p_estate_id
  ) then
    v_code_id := null;
  end if;

  -- 0. resolve string -> id INSIDE the transaction (§4.1). Prefer an active
  --    row; fall back to the most recent so a used/revoked code still reports
  --    precisely. Resolving OUTSIDE would risk a false collision, since a code
  --    string is legally reusable once the old row leaves 'active'.
  if v_code_id is null and p_code is not null then
    select ac.id into v_code_id
      from public.access_codes ac
     where ac.estate_id = p_estate_id
       and ac.code = p_code
     order by (ac.status = 'active') desc, ac.created_at desc
     limit 1;
  end if;

  -- 1. claim the event id. wins exactly once, ever.
  insert into public.verification_events (
    client_event_id, estate_id, code_id, code_attempted, verified_by_membership_id,
    verified_at, synced_at, source, outcome, collision, pool_age_seconds)
  values (
    p_client_event_id, p_estate_id, v_code_id, upper(btrim(p_code)), p_membership_id,
    p_verified_at, now(), p_source, 'pending', false, p_pool_age)
  on conflict (verified_by_membership_id, client_event_id) do nothing
  returning * into v_event;

  -- 2. already ingested -> replay the STORED verdict, never recompute one.
  --    Recomputing is what turns a lost ack into a phantom collision.
  if v_event.id is null then
    select * into v_event
      from public.verification_events ve
     where ve.verified_by_membership_id = p_membership_id
       and ve.client_event_id = p_client_event_id;
    return v_event;
  end if;

  -- 3. unresolvable code string.
  if v_code_id is null then
    if v_flagged then
      -- The override, and the case it exists for. There is nothing to burn and
      -- nobody to notify — we do not know whose visitor this was, which is
      -- precisely what the admin has to reconcile. Recorded as admitted
      -- because the visitor was admitted; the flag is what makes it reviewable
      -- rather than indistinguishable from a normal entry.
      update public.verification_events
         set outcome = 'admitted', admitted_without_match = true
       where id = v_event.id
      returning * into v_event;
    else
      -- Record the attempt, burn nothing. Failed attempts are part of the
      -- audit trail (§2.5).
      update public.verification_events
         set outcome = 'rejected', reject_reason = 'unknown_code'
       where id = v_event.id
      returning * into v_event;
    end if;
    return v_event;
  end if;

  -- 4. the conditional burn (§4.1). `status = 'active'` is the guard against
  --    double-burn: a second attempt matches zero rows. The estate_id
  --    predicate is what stops a guard burning another tenant's code even with
  --    a valid code_id.
  --
  --    A flagged event still burns. The guard overrode a verdict their DEVICE
  --    reached; if the code turns out to be real and live — minted during the
  --    outage, which is the commonest reason the pool missed it — then it has
  --    genuinely been used and must not stay spendable. The flag is kept
  --    either way, so the admin sees that the override happened and that it
  --    turned out to be sound.
  update public.access_codes
     set status = 'used',
         used_at = p_verified_at,
         verified_by_membership_id = p_membership_id
   where id = v_code_id
     and estate_id = p_estate_id
     and status = 'active'
     and expires_at > now()
  returning id, membership_id, code into v_burned, v_owner, v_code_str;

  if v_burned is not null then
    v_outcome := 'admitted'; v_collide := false; v_reason := null;

    -- 5. notify the resident. Same transaction as the burn (§2.7). A replayed
    --    duplicate returns at step 2 and never reaches here, so a retried push
    --    cannot re-notify.
    perform pgmq.send('notifications', jsonb_build_object(
      'kind',          'code_used',
      'membership_id', v_owner,
      'code',          v_code_str,
      'verified_at',   p_verified_at
    ));
  else
    select ac.status into v_status
      from public.access_codes ac
     where ac.id = v_code_id and ac.estate_id = p_estate_id;

    if v_status = 'used' then
      -- burned by a DIFFERENT event: a genuine double-entry
      v_outcome := 'collision'; v_collide := true;  v_reason := 'already_used';
    elsif v_status = 'revoked' then
      v_outcome := 'rejected';  v_collide := false; v_reason := 'revoked';
    else
      v_outcome := 'rejected';  v_collide := false; v_reason := 'expired';
    end if;

    -- The guard let them in and the code was NOT spendable — expired, revoked,
    -- or already burned at another gate. The server's reason is the true one
    -- and is kept, but the person is through the gate either way, so the flag
    -- has to survive or the entry reads as an ordinary refusal.
    if v_flagged then
      v_outcome := 'admitted'; v_collide := false;
    end if;
  end if;

  update public.verification_events
     set outcome                = v_outcome,
         collision              = v_collide,
         reject_reason          = v_reason,
         admitted_without_match = v_flagged
   where id = v_event.id
  returning * into v_event;

  return v_event;
end;
$$;
-- ─── 9. A trigger function left executable by everyone ──────────────────────
--
-- Not reachable through the API (a trigger function refuses a direct call),
-- but it is the one function in public still granted to PUBLIC.
revoke execute on function public.freeze_agency_stamp() from public, anon, authenticated;

-- ─── 10. A phone kept the previous person's notifications ───────────────────
--
-- The apps now delete their token on sign-out, but a phone where that never
-- ran (app killed, an older build, a session that expired first) kept the
-- previous person's row, so the next person to sign in on it shared a device
-- with a stranger's "your visitor has arrived". One phone has one Expo token
-- and one person at a time: whoever registers it now takes it, from anyone
-- else's memberships. The same person's other memberships keep it.
create or replace function public.register_push_token(
  p_estate_id uuid,
  p_role      text,
  p_token     text,
  p_device_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid := public.current_membership(p_estate_id, p_role);
begin
  if v_membership_id is null then
    raise exception 'no_active_membership' using errcode = '42501';
  end if;

  delete from public.push_tokens pt
   using public.memberships m
   where m.id = pt.membership_id
     and pt.expo_push_token = p_token
     and m.user_id <> (select auth.uid());

  insert into public.push_tokens (membership_id, expo_push_token, device_id)
  values (v_membership_id, p_token, p_device_id)
  on conflict (membership_id, expo_push_token)
  do update set last_seen_at = now(), device_id = excluded.device_id;
  -- `excluded` is the proposed row; the existing row would be `push_tokens.*`.
end;
$$;
