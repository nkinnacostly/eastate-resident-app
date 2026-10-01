-- Estate Access Platform — detail views on every dashboard
--
-- Every list on every admin surface now opens a record: an estate, a person, a
-- resident, a house, an officer. Each detail is defined ONCE, in a private
-- helper, and exposed through a thin RPC per surface that decides who may ask.
-- Two dashboards showing the same guard must not be able to disagree about
-- their hours, so the arithmetic lives in one place.
--
-- Who sees what is the substance of this file:
--
--   platform owner  everything about an estate and any person on the platform,
--                   but never a code string -- same boundary as the operator
--                   dashboard has always had.
--   estate admin    their own residents and houses, codes included (they
--                   already see codes on the Codes page).
--   agency admin    their OWN employees and the estates they hold contracts
--                   at, as counts. Never a resident, a visitor or an individual
--                   entry -- see 20260926140000 for why that is a legal line,
--                   not a design preference.
--   landlord        their own house's bill and the payments against it. Never
--                   a tenant's name, and never a tenant's personal dues.
--
-- Detail RPCs return jsonb. A detail page is one record with several nested
-- lists, and a RETURNS TABLE per list would be four round trips and four
-- authorisation checks that could drift apart.
--
-- Target ids (p_membership_id, p_house_id, p_target_user_id ...) name the thing
-- being LOOKED AT. The caller's identity still comes only from auth.uid(), and
-- every wrapper checks the target belongs to the scope the caller holds.

-- ─── Guard: one definition for every dashboard ───────────────────────────────

create function private.guard_profile_row(p_membership_id uuid)
returns table (
  membership_id        uuid,
  user_id              uuid,
  full_name            text,
  phone                text,
  email                text,
  is_active            boolean,
  joined_at            timestamptz,
  last_sign_in_at      timestamptz,
  agency_name          text,
  psira_registration_number text,
  psira_grade          text,
  psira_expires_at     timestamptz,
  psira_verified_at    timestamptz,
  on_duty_since        timestamptz,
  shifts_30d           integer,
  hours_on_duty_30d    numeric,
  last_shift_at        timestamptz,
  verifications_30d    integer,
  admitted_30d         integer,
  rejected_30d         integer,
  offline_30d          integer,
  flagged_30d          integer,
  last_verification_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with w as (select now() - interval '30 days' as since)
  select
    m.id,
    m.user_id,
    coalesce(nullif(btrim(p.full_name), ''), 'Unnamed'),
    p.phone,
    u.email::text,
    m.is_active,
    m.created_at,
    u.last_sign_in_at,
    a.name,
    p.psira_registration_number,
    p.psira_grade,
    p.psira_expires_at,
    p.psira_verified_at,
    (select s.started_at from public.guard_shifts s
      where s.membership_id = m.id and s.ended_at is null
      order by s.started_at desc limit 1),
    (select count(*) from public.guard_shifts s
      where s.membership_id = m.id and coalesce(s.ended_at, now()) > w.since)::integer,
    -- Clipped to the window; server times only. See 20261001120000.
    round((select coalesce(sum(extract(epoch from
              least(coalesce(s.ended_at, now()), now()) - greatest(s.started_at, w.since))), 0)
             from public.guard_shifts s
            where s.membership_id = m.id
              and coalesce(s.ended_at, now()) > w.since) / 3600.0, 1),
    (select max(s.started_at) from public.guard_shifts s where s.membership_id = m.id),
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > w.since)::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > w.since
        and v.outcome = 'admitted')::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > w.since
        and v.outcome in ('rejected', 'collision'))::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > w.since
        and v.source = 'offline_replay')::integer,
    (select count(*) from public.verification_events v
      where v.verified_by_membership_id = m.id and v.synced_at > w.since
        and v.admitted_without_match)::integer,
    (select max(v.synced_at) from public.verification_events v
      where v.verified_by_membership_id = m.id)
  from w
  cross join public.memberships m
  join auth.users u           on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  left join public.agencies a on a.id = m.placed_by_agency_id
  where m.id = p_membership_id
    and m.role = 'guard';
$$;

revoke execute on function private.guard_profile_row(uuid) from public, anon, authenticated;

create function private.guard_shift_rows(p_membership_id uuid, p_limit integer)
returns table (shift_id uuid, started_at timestamptz, ended_at timestamptz, ended_by_handover boolean)
language sql
stable
set search_path = ''
as $$
  select s.id, s.started_at, s.ended_at, s.ended_by_handover
    from public.guard_shifts s
   where s.membership_id = p_membership_id
   order by s.started_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;

revoke execute on function private.guard_shift_rows(uuid, integer) from public, anon, authenticated;

-- The estate admin's guard RPCs now read the shared definition. Same signature
-- and return shape, so CREATE OR REPLACE and no client change.
create or replace function public.estate_guard_profile(p_estate_id uuid, p_guard_membership_id uuid)
returns table (
  membership_id        uuid,
  user_id              uuid,
  full_name            text,
  phone                text,
  email                text,
  is_active            boolean,
  joined_at            timestamptz,
  last_sign_in_at      timestamptz,
  agency_name          text,
  psira_registration_number text,
  psira_grade          text,
  psira_expires_at     timestamptz,
  psira_verified_at    timestamptz,
  on_duty_since        timestamptz,
  shifts_30d           integer,
  hours_on_duty_30d    numeric,
  last_shift_at        timestamptz,
  verifications_30d    integer,
  admitted_30d         integer,
  rejected_30d         integer,
  offline_30d          integer,
  flagged_30d          integer,
  last_verification_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_estate_id is null or public.current_membership(p_estate_id, 'admin') is null then
    raise exception 'not_an_estate_admin' using errcode = '42501';
  end if;
  return query
  select g.* from private.guard_profile_row(p_guard_membership_id) g
   where exists (select 1 from public.memberships m
                  where m.id = p_guard_membership_id and m.estate_id = p_estate_id);
end;
$$;

create or replace function public.estate_guard_shifts(
  p_estate_id uuid,
  p_guard_membership_id uuid,
  p_limit integer default 50
)
returns table (
  shift_id          uuid,
  started_at        timestamptz,
  ended_at          timestamptz,
  ended_by_handover boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_estate_id is null or public.current_membership(p_estate_id, 'admin') is null then
    raise exception 'not_an_estate_admin' using errcode = '42501';
  end if;
  return query
  select r.* from private.guard_shift_rows(p_guard_membership_id, p_limit) r
   where exists (select 1 from public.memberships m
                  where m.id = p_guard_membership_id and m.estate_id = p_estate_id
                    and m.role = 'guard');
end;
$$;

-- Gate entries WITHOUT the code string, for the operator. Hosts are named,
-- because an operator investigating a flagged entry needs to know whose
-- visitor it was; the characters the resident sent are never returned.
create function private.gate_event_rows(
  p_estate_id      uuid,
  p_membership_ids uuid[],
  p_limit          integer
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.synced_at desc), '[]'::jsonb)
    from (
      select v.id, v.verified_at, v.synced_at, v.outcome::text as outcome,
             v.reject_reason::text as reject_reason, v.source::text as source,
             v.admitted_without_match as flagged,
             e.name as estate_name,
             gp.full_name as guard_name,
             hp.full_name as host_name,
             coalesce(hh.house_number, hm.unit) as host_unit
        from public.verification_events v
        join public.estates e on e.id = v.estate_id
        left join public.memberships gm on gm.id = v.verified_by_membership_id
        left join public.profiles gp    on gp.id = gm.user_id
        left join public.access_codes c on c.id = v.code_id
        left join public.memberships hm on hm.id = c.membership_id
        left join public.profiles hp    on hp.id = hm.user_id
        left join public.houses hh      on hh.id = hm.house_id
       where (p_estate_id is null or v.estate_id = p_estate_id)
         and (p_membership_ids is null or v.verified_by_membership_id = any (p_membership_ids))
       -- Server clock, never the device's. See CLAUDE.md.
       order by v.synced_at desc
       limit least(greatest(coalesce(p_limit, 30), 1), 200)
    ) t;
$$;

revoke execute on function private.gate_event_rows(uuid, uuid[], integer) from public, anon, authenticated;

-- ─── A resident ──────────────────────────────────────────────────────────────

create function private.resident_detail(p_membership_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with m as (
    select m.*, h.house_number, h.landlord_name,
           (select t.payer from public.house_dues_terms(m.house_id) t) as house_payer
      from public.memberships m
      left join public.houses h on h.id = m.house_id
     where m.id = p_membership_id and m.role = 'resident'
  ),
  since as (select now() - interval '30 days' as t)
  select jsonb_build_object(
    'person', (
      select jsonb_build_object(
        'membership_id', m.id, 'user_id', m.user_id,
        'full_name', coalesce(nullif(btrim(p.full_name), ''), 'Unnamed'),
        'phone', p.phone, 'email', u.email, 'last_sign_in_at', u.last_sign_in_at,
        'unit', m.unit, 'house_id', m.house_id, 'house_number', m.house_number,
        'is_active', m.is_active, 'joined_at', m.created_at,
        -- Who pays this resident's dues: themselves, or their landlord.
        'dues_payer', case when m.house_payer = 'landlord' then 'landlord' else 'resident' end)
        from m join auth.users u on u.id = m.user_id
        left join public.profiles p on p.id = m.user_id),
    'stats', (
      select jsonb_build_object(
        -- Live is DERIVED: an 'active' row past its expiry occupies no slot.
        'live_codes', (select count(*) from public.access_codes c
                        where c.membership_id = m.id and c.status = 'active' and c.expires_at > now()),
        'codes_30d', (select count(*) from public.access_codes c, since
                       where c.membership_id = m.id and c.created_at > since.t),
        'deliveries_30d', (select count(*) from public.access_codes c, since
                            where c.membership_id = m.id and c.created_at > since.t and c.is_delivery),
        'visitors_admitted_30d', (select count(*) from public.verification_events v
                                    join public.access_codes c on c.id = v.code_id, since
                                   where c.membership_id = m.id and v.outcome = 'admitted'
                                     and v.synced_at > since.t),
        'last_code_at', (select max(c.created_at) from public.access_codes c where c.membership_id = m.id),
        'in_arrears', public.dues_in_arrears(m.id))
        from m),
    'household', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'membership_id', o.id,
               'full_name', coalesce(nullif(btrim(op.full_name), ''), 'Unnamed'),
               'is_active', o.is_active) order by op.full_name), '[]'::jsonb)
        from m join public.memberships o
          on o.house_id = m.house_id and o.role = 'resident' and o.id <> m.id
        left join public.profiles op on op.id = o.user_id),
    -- Their own charges, plus the house's where the landlord is billed: the
    -- house bill is what pauses their codes, so an admin answering "why can't
    -- I make a code" needs to see it here.
    'charges', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'charge_id', c.id, 'period', c.period, 'amount_minor', c.amount_minor,
               'currency', c.currency, 'due_on', c.due_on, 'status', c.status,
               'paid_at', c.paid_at, 'waive_reason', c.waive_reason,
               'subject', case when c.house_id is not null then 'house' else 'resident' end)
             order by c.period desc), '[]'::jsonb)
        from m join public.dues_charges c
          on c.membership_id = m.id
          or (m.house_payer = 'landlord' and c.house_id = m.house_id)),
    'codes', (
      select coalesce(jsonb_agg(row_to_json(k)::jsonb order by k.created_at desc), '[]'::jsonb)
        from (
          select c.id, c.code, c.created_at, c.expires_at, c.is_delivery, c.delivery_note,
                 c.used_at, c.revoked_at,
                 case when c.status = 'active' and c.expires_at <= now() then 'expired'
                      else c.status::text end as status
            from m join public.access_codes c on c.membership_id = m.id
           order by c.created_at desc
           limit 30
        ) k)
  )
  from m;
$$;

revoke execute on function private.resident_detail(uuid) from public, anon, authenticated;

create function public.estate_resident_detail(p_estate_id uuid, p_membership_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_estate_id is null or public.current_membership(p_estate_id, 'admin') is null then
    raise exception 'not_an_estate_admin' using errcode = '42501';
  end if;
  -- Null rather than an error for someone else's resident: "not found" and
  -- "not yours" must look the same, or the answer confirms the id exists.
  if not exists (select 1 from public.memberships m
                  where m.id = p_membership_id and m.estate_id = p_estate_id
                    and m.role = 'resident') then
    return null;
  end if;
  return private.resident_detail(p_membership_id);
end;
$$;

revoke execute on function public.estate_resident_detail(uuid, uuid) from public, anon;
grant  execute on function public.estate_resident_detail(uuid, uuid) to authenticated;

-- ─── A house ─────────────────────────────────────────────────────────────────

create function private.house_detail(p_house_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with h as (select * from public.houses where id = p_house_id),
  t as (select * from public.house_dues_terms(p_house_id))
  select jsonb_build_object(
    'house', (
      select jsonb_build_object(
        'house_id', h.id, 'house_number', h.house_number, 'house_code', h.house_code,
        'is_active', h.is_active, 'created_at', h.created_at,
        'landlord_name', h.landlord_name, 'landlord_phone', h.landlord_phone,
        'landlord_email', h.landlord_email,
        'dues_payer_override', h.dues_payer, 'dues_amount_override', h.dues_amount_minor,
        -- The terms in force, which is what anyone reading this actually needs.
        'dues_payer', (select t.payer from t), 'dues_amount_minor', (select t.amount_minor from t),
        'currency', (select t.currency from t), 'grace_days', (select t.grace_days from t))
        from h),
    'residents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'membership_id', m.id,
               'full_name', coalesce(nullif(btrim(p.full_name), ''), 'Unnamed'),
               'phone', p.phone, 'is_active', m.is_active, 'joined_at', m.created_at)
             order by m.is_active desc, p.full_name), '[]'::jsonb)
        from public.memberships m left join public.profiles p on p.id = m.user_id
       where m.house_id = p_house_id and m.role = 'resident'),
    'charges', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'charge_id', c.id, 'period', c.period, 'amount_minor', c.amount_minor,
               'currency', c.currency, 'due_on', c.due_on, 'status', c.status,
               'paid_at', c.paid_at, 'waive_reason', c.waive_reason,
               'subject', case when c.house_id is not null then 'house' else 'resident' end,
               'resident_name', rp.full_name)
             order by c.period desc, rp.full_name), '[]'::jsonb)
        from public.dues_charges c
        left join public.memberships rm on rm.id = c.membership_id
        left join public.profiles rp on rp.id = rm.user_id
       where c.house_id = p_house_id or rm.house_id = p_house_id),
    'stats', jsonb_build_object(
      'codes_30d', (select count(*) from public.access_codes c
                      join public.memberships m on m.id = c.membership_id
                     where m.house_id = p_house_id and c.created_at > now() - interval '30 days'),
      'visitors_admitted_30d', (select count(*) from public.verification_events v
                                  join public.access_codes c on c.id = v.code_id
                                  join public.memberships m on m.id = c.membership_id
                                 where m.house_id = p_house_id and v.outcome = 'admitted'
                                   and v.synced_at > now() - interval '30 days'))
  )
  from h;
$$;

revoke execute on function private.house_detail(uuid) from public, anon, authenticated;

create function public.estate_house_detail(p_estate_id uuid, p_house_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_estate_id is null or public.current_membership(p_estate_id, 'admin') is null then
    raise exception 'not_an_estate_admin' using errcode = '42501';
  end if;
  if not exists (select 1 from public.houses h
                  where h.id = p_house_id and h.estate_id = p_estate_id) then
    return null;
  end if;
  return private.house_detail(p_house_id);
end;
$$;

revoke execute on function public.estate_house_detail(uuid, uuid) from public, anon;
grant  execute on function public.estate_house_detail(uuid, uuid) to authenticated;

-- ─── The platform owner: an estate ───────────────────────────────────────────

create function public.operator_estate_detail(p_estate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since constant timestamptz := now() - interval '30 days';
  v_out   jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'estate', jsonb_build_object(
      'id', e.id, 'name', e.name, 'address', e.address, 'contact_info', e.contact_info,
      'join_code', e.join_code, 'is_active', e.is_active, 'created_at', e.created_at),
    'counts', jsonb_build_object(
      'houses', (select count(*) from public.houses h where h.estate_id = e.id and h.is_active),
      'residents', (select count(*) from public.memberships m
                     where m.estate_id = e.id and m.role = 'resident' and m.is_active),
      'guards', (select count(*) from public.memberships m
                  where m.estate_id = e.id and m.role = 'guard' and m.is_active),
      'admins', (select count(*) from public.memberships m
                  where m.estate_id = e.id and m.role = 'admin' and m.is_active)),
    'gate_30d', jsonb_build_object(
      'verifications', (select count(*) from public.verification_events v
                         where v.estate_id = e.id and v.synced_at > v_since),
      'admitted', (select count(*) from public.verification_events v
                    where v.estate_id = e.id and v.synced_at > v_since and v.outcome = 'admitted'),
      'refused', (select count(*) from public.verification_events v
                   where v.estate_id = e.id and v.synced_at > v_since
                     and v.outcome in ('rejected', 'collision')),
      'offline', (select count(*) from public.verification_events v
                   where v.estate_id = e.id and v.synced_at > v_since and v.source = 'offline_replay'),
      'flagged', (select count(*) from public.verification_events v
                   where v.estate_id = e.id and v.synced_at > v_since and v.admitted_without_match),
      'last_activity', (select max(v.synced_at) from public.verification_events v where v.estate_id = e.id),
      'on_duty_name', (select gp.full_name from public.guard_shifts s
                         join public.memberships gm on gm.id = s.membership_id
                         left join public.profiles gp on gp.id = gm.user_id
                        where s.estate_id = e.id and s.ended_at is null limit 1),
      'on_duty_since', (select s.started_at from public.guard_shifts s
                         where s.estate_id = e.id and s.ended_at is null limit 1)),
    'dues', jsonb_build_object(
      'billing_mode', e.dues_billing_mode, 'amount_minor', e.dues_amount_minor,
      'currency', e.dues_currency, 'grace_days', e.dues_grace_days,
      'enforcement_on', e.dues_enforcement_authorised_at is not null,
      'platform_fee_percent', e.platform_fee_percent,
      'outstanding_minor', (select coalesce(sum(c.amount_minor), 0) from public.dues_charges c
                             where c.estate_id = e.id and c.status = 'open'),
      'open_charges', (select count(*) from public.dues_charges c
                        where c.estate_id = e.id and c.status = 'open'),
      'collected_30d_minor', (select coalesce(sum(p.amount_minor), 0) from public.dues_payments p
                                join public.dues_charges c on c.id = p.charge_id
                               where c.estate_id = e.id and p.status = 'successful'
                                 and p.settled_at > v_since)),
    'settlement', jsonb_build_object(
      'bank_name', e.settlement_bank_name,
      'account_mask', public.mask_account_number(e.settlement_account_number),
      'account_name', e.settlement_account_name,
      'verified', e.settlement_account_verified,
      'configured_at', e.settlement_verified_at),
    'agencies', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'agency_name', a.name, 'starts_on', ac.starts_on, 'ends_on', ac.ends_on,
               'revoked_at', ac.revoked_at,
               'live', ac.during @> now() and ac.revoked_at is null)
             order by ac.starts_on desc), '[]'::jsonb)
        from public.agency_contracts ac join public.agencies a on a.id = ac.agency_id
       where ac.estate_id = e.id),
    'people', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'membership_id', m.id, 'user_id', m.user_id, 'role', m.role,
               'full_name', coalesce(nullif(btrim(p.full_name), ''), 'Unnamed'),
               'email', u.email, 'phone', p.phone, 'house_number', h.house_number,
               'is_active', m.is_active, 'joined_at', m.created_at,
               'last_sign_in_at', u.last_sign_in_at)
             order by m.role, m.is_active desc, p.full_name), '[]'::jsonb)
        from public.memberships m
        join auth.users u on u.id = m.user_id
        left join public.profiles p on p.id = m.user_id
        left join public.houses h on h.id = m.house_id
       where m.estate_id = e.id),
    'houses', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'house_id', h.id, 'house_number', h.house_number, 'is_active', h.is_active,
               'landlord_name', h.landlord_name,
               'dues_payer', (select t.payer from public.house_dues_terms(h.id) t),
               'residents', (select count(*) from public.memberships m
                              where m.house_id = h.id and m.role = 'resident' and m.is_active),
               'outstanding_minor', (select coalesce(sum(c.amount_minor), 0)
                                       from public.dues_charges c
                                       left join public.memberships rm on rm.id = c.membership_id
                                      where (c.house_id = h.id or rm.house_id = h.id)
                                        and c.status = 'open'))
             order by h.house_number), '[]'::jsonb)
        from public.houses h where h.estate_id = e.id),
    'events', private.gate_event_rows(e.id, null, 30)
  )
  into v_out
  from public.estates e
  where e.id = p_estate_id;

  return v_out;
end;
$$;

revoke execute on function public.operator_estate_detail(uuid) from public, anon;
grant  execute on function public.operator_estate_detail(uuid) to authenticated;

-- ─── The platform owner: a person ────────────────────────────────────────────
--
-- One page per HUMAN, not per membership: the same person can be a resident at
-- one estate, a guard at another and an agency officer. Seeing that in one
-- place is the point of an operator view.

create function public.operator_person_detail(p_target_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_guards uuid[];
  v_out    jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  select array_agg(m.id) into v_guards
    from public.memberships m where m.user_id = p_target_user_id and m.role = 'guard';

  select jsonb_build_object(
    'person', jsonb_build_object(
      'user_id', u.id,
      'full_name', coalesce(nullif(btrim(p.full_name), ''), 'Unnamed'),
      'phone', p.phone, 'email', u.email,
      'email_confirmed', u.email_confirmed_at is not null,
      'last_sign_in_at', u.last_sign_in_at,
      'is_platform_admin', exists (select 1 from public.platform_admins pa where pa.user_id = u.id),
      'psira_registration_number', p.psira_registration_number, 'psira_grade', p.psira_grade,
      'psira_expires_at', p.psira_expires_at, 'psira_verified_at', p.psira_verified_at),
    'memberships', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'membership_id', m.id, 'estate_id', m.estate_id, 'estate_name', e.name,
               'role', m.role, 'is_active', m.is_active, 'joined_at', m.created_at,
               'house_number', h.house_number, 'agency_name', a.name)
             order by m.is_active desc, e.name), '[]'::jsonb)
        from public.memberships m
        join public.estates e on e.id = m.estate_id
        left join public.houses h on h.id = m.house_id
        left join public.agencies a on a.id = m.placed_by_agency_id
       where m.user_id = u.id),
    'agencies', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'agency_name', a.name, 'role', am.role, 'is_active', am.is_active,
               'joined_at', am.created_at) order by a.name), '[]'::jsonb)
        from public.agency_memberships am join public.agencies a on a.id = am.agency_id
       where am.user_id = u.id),
    -- Every guard posting, each with the same stats the estate admin sees.
    'guard', (
      select coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object('estate_name', e.name)), '[]'::jsonb)
        from unnest(coalesce(v_guards, '{}')) gid
        cross join lateral private.guard_profile_row(gid) g
        join public.memberships m on m.id = gid
        join public.estates e on e.id = m.estate_id),
    'shifts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'shift_id', s.id, 'estate_name', e.name, 'started_at', s.started_at,
               'ended_at', s.ended_at, 'ended_by_handover', s.ended_by_handover)
             order by s.started_at desc), '[]'::jsonb)
        from (select * from public.guard_shifts s
               where s.membership_id = any (coalesce(v_guards, '{}'))
               order by s.started_at desc limit 50) s
        join public.estates e on e.id = s.estate_id),
    'events', case when v_guards is null then '[]'::jsonb
                   else private.gate_event_rows(null, v_guards, 30) end
  )
  into v_out
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_target_user_id;

  return v_out;
end;
$$;

revoke execute on function public.operator_person_detail(uuid) from public, anon;
grant  execute on function public.operator_person_detail(uuid) to authenticated;

-- ─── The agency: one of its officers ─────────────────────────────────────────
--
-- The agency's own employee, so personal data is legitimate (PSIRA Code 11(2)
-- requires the agency to have vetted them). Their WORK is shown only where it
-- carries this agency's stamp: a shift worked for a different agency, or for
-- an estate directly, is not this agency's business. And gate activity is
-- COUNTS -- no individual entry, no resident, no visitor.

create function public.agency_officer_detail(p_agency_membership_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  am      public.agency_memberships%rowtype;
  v_since constant timestamptz := now() - interval '30 days';
  v_out   jsonb;
begin
  select * into am from public.agency_memberships where id = p_agency_membership_id;
  if am.id is null then
    -- Same refusal as "not yours": an unknown id must not be distinguishable.
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;
  if not public.is_agency_admin(am.agency_id) and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'officer', jsonb_build_object(
      'agency_membership_id', am.id,
      'full_name', coalesce(nullif(btrim(p.full_name), ''), 'Unnamed'),
      'phone', p.phone, 'email', u.email, 'role', am.role, 'is_active', am.is_active,
      'joined_at', am.created_at, 'last_sign_in_at', u.last_sign_in_at,
      'psira_registration_number', p.psira_registration_number, 'psira_grade', p.psira_grade,
      'psira_expires_at', p.psira_expires_at, 'psira_verified_at', p.psira_verified_at),
    'postings', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'estate_id', e.id, 'estate_name', e.name, 'is_active', m.is_active,
               'posted_at', m.created_at,
               'on_duty_since', (select s.started_at from public.guard_shifts s
                                  where s.membership_id = m.id and s.ended_at is null
                                    and s.agency_id = am.agency_id limit 1))
             order by m.is_active desc, e.name), '[]'::jsonb)
        from public.memberships m join public.estates e on e.id = m.estate_id
       where m.user_id = am.user_id and m.role = 'guard'
         and m.placed_by_agency_id = am.agency_id),
    'stats_30d', jsonb_build_object(
      'shifts', (select count(*) from public.guard_shifts s
                   join public.memberships m on m.id = s.membership_id
                  where m.user_id = am.user_id and s.agency_id = am.agency_id
                    and s.started_at > v_since),
      'hours', (select round(coalesce(sum(extract(epoch from
                         coalesce(s.ended_at, now()) - s.started_at)), 0) / 3600.0, 1)
                  from public.guard_shifts s
                  join public.memberships m on m.id = s.membership_id
                 where m.user_id = am.user_id and s.agency_id = am.agency_id
                   and s.started_at > v_since),
      'admitted', (select count(*) from public.verification_events v
                     join public.memberships m on m.id = v.verified_by_membership_id
                    where m.user_id = am.user_id and v.agency_id = am.agency_id
                      and v.synced_at > v_since and v.outcome = 'admitted'
                      and not v.admitted_without_match),
      'refused', (select count(*) from public.verification_events v
                    join public.memberships m on m.id = v.verified_by_membership_id
                   where m.user_id = am.user_id and v.agency_id = am.agency_id
                     and v.synced_at > v_since and v.outcome in ('rejected', 'collision')),
      'flagged', (select count(*) from public.verification_events v
                    join public.memberships m on m.id = v.verified_by_membership_id
                   where m.user_id = am.user_id and v.agency_id = am.agency_id
                     and v.synced_at > v_since and v.admitted_without_match)),
    -- Attendance: when their employee held which gate. About the officer, not
    -- about anyone who came through it.
    'shifts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'estate_name', e.name, 'started_at', s.started_at, 'ended_at', s.ended_at,
               'ended_by_handover', s.ended_by_handover) order by s.started_at desc), '[]'::jsonb)
        from (select s.* from public.guard_shifts s
                join public.memberships m on m.id = s.membership_id
               where m.user_id = am.user_id and s.agency_id = am.agency_id
               order by s.started_at desc limit 50) s
        join public.estates e on e.id = s.estate_id)
  )
  into v_out
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = am.user_id;

  return v_out;
end;
$$;

revoke execute on function public.agency_officer_detail(uuid) from public, anon;
grant  execute on function public.agency_officer_detail(uuid) to authenticated;

-- ─── The agency: an estate it guards ─────────────────────────────────────────

create function public.agency_estate_detail(p_agency_id uuid, p_estate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not public.is_agency_admin(p_agency_id) and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;
  -- An agency that never held a contract here learns nothing, not even that
  -- the estate exists -- the rule agency_coverage_summary already follows.
  if not exists (select 1 from public.agency_contracts c
                  where c.agency_id = p_agency_id and c.estate_id = p_estate_id) then
    return null;
  end if;

  select jsonb_build_object(
    'estate', jsonb_build_object('id', e.id, 'name', e.name, 'address', e.address),
    'contracts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'starts_on', c.starts_on, 'ends_on', c.ends_on, 'revoked_at', c.revoked_at,
               'live', c.during @> now() and c.revoked_at is null) order by c.starts_on desc), '[]'::jsonb)
        from public.agency_contracts c
       where c.agency_id = p_agency_id and c.estate_id = e.id),
    'officers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'agency_membership_id', am.id,
               'full_name', coalesce(nullif(btrim(p.full_name), ''), 'Unnamed'),
               'is_active', m.is_active and am.is_active, 'posted_at', m.created_at,
               'on_duty', exists (select 1 from public.guard_shifts s
                                   where s.membership_id = m.id and s.ended_at is null
                                     and s.agency_id = p_agency_id))
             order by m.is_active desc, p.full_name), '[]'::jsonb)
        from public.memberships m
        left join public.profiles p on p.id = m.user_id
        left join public.agency_memberships am
          on am.user_id = m.user_id and am.agency_id = p_agency_id
       where m.estate_id = e.id and m.role = 'guard' and m.placed_by_agency_id = p_agency_id),
    -- Six months of the service, as counts. Agency-stamped rows only.
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', mo.m,
               'shifts', (select count(*) from public.guard_shifts s
                           where s.estate_id = e.id and s.agency_id = p_agency_id
                             and s.started_at >= mo.m and s.started_at < mo.m + interval '1 month'),
               'hours', (select round(coalesce(sum(extract(epoch from
                                  coalesce(s.ended_at, now()) - s.started_at)), 0) / 3600.0, 1)
                           from public.guard_shifts s
                          where s.estate_id = e.id and s.agency_id = p_agency_id
                            and s.started_at >= mo.m and s.started_at < mo.m + interval '1 month'),
               'admitted', (select count(*) from public.verification_events v
                             where v.estate_id = e.id and v.agency_id = p_agency_id
                               and v.synced_at >= mo.m and v.synced_at < mo.m + interval '1 month'
                               and v.outcome = 'admitted' and not v.admitted_without_match),
               'refused', (select count(*) from public.verification_events v
                            where v.estate_id = e.id and v.agency_id = p_agency_id
                              and v.synced_at >= mo.m and v.synced_at < mo.m + interval '1 month'
                              and v.outcome in ('rejected', 'collision')),
               'flagged', (select count(*) from public.verification_events v
                            where v.estate_id = e.id and v.agency_id = p_agency_id
                              and v.synced_at >= mo.m and v.synced_at < mo.m + interval '1 month'
                              and v.admitted_without_match))
             order by mo.m desc), '[]'::jsonb)
        from (select (date_trunc('month', now()) - make_interval(months => i)) as m
                from generate_series(0, 5) i) mo)
  )
  into v_out
  from public.estates e
  where e.id = p_estate_id;

  return v_out;
end;
$$;

revoke execute on function public.agency_estate_detail(uuid, uuid) from public, anon;
grant  execute on function public.agency_estate_detail(uuid, uuid) to authenticated;

-- ─── The landlord: one of their houses ───────────────────────────────────────
--
-- Their bill and the payments against it. Two things are deliberately absent:
--   * tenants' names -- the landlord dashboard counts residents, never lists
--     them (20260928100000);
--   * tenants' personal dues where the house bills its residents -- what the
--     people living there owe is between them and the estate.
-- A payment made by somebody else is described by HOW it was paid, never by
-- who: "a resident, in the app" or "the payment link", not a name or address.

create function public.landlord_house_detail(p_house_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := public.current_verified_email();
  v_out   jsonb;
begin
  if v_email is null or not exists (
    select 1 from public.houses h
     where h.id = p_house_id and lower(btrim(h.landlord_email)) = v_email
  ) then
    return null;
  end if;

  select jsonb_build_object(
    'house', jsonb_build_object(
      'house_id', h.id, 'house_number', h.house_number, 'estate_name', e.name,
      'estate_contact', e.contact_info, 'is_active', h.is_active,
      'dues_payer', t.payer, 'dues_amount_minor', t.amount_minor,
      'currency', t.currency, 'grace_days', t.grace_days,
      'residents', (select count(*) from public.memberships m
                     where m.house_id = h.id and m.role = 'resident' and m.is_active)),
    'charges', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'charge_id', c.id, 'period', c.period, 'amount_minor', c.amount_minor,
               'currency', c.currency, 'due_on', c.due_on, 'status', c.status,
               'paid_at', c.paid_at, 'waive_reason', c.waive_reason)
             order by c.period desc), '[]'::jsonb)
        from public.dues_charges c where c.house_id = h.id),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'created_at', p.created_at, 'settled_at', p.settled_at, 'status', p.status,
               'amount_minor', p.amount_minor, 'currency', p.currency, 'months', p.months,
               'covers_from', coalesce((select min(pp.period) from public.dues_payment_periods pp
                                         where pp.payment_id = p.id), c.period),
               'covers_until', coalesce((select max(pp.period) from public.dues_payment_periods pp
                                          where pp.payment_id = p.id), c.period),
               'paid_via', case
                 when lower(btrim(coalesce(p.payer_email, ''))) = v_email then 'you'
                 when p.initiated_by_membership_id is not null then 'resident'
                 else 'pay_link' end)
             order by p.created_at desc), '[]'::jsonb)
        from public.dues_payments p join public.dues_charges c on c.id = p.charge_id
       where c.house_id = h.id)
  )
  into v_out
  from public.houses h
  join public.estates e on e.id = h.estate_id
  left join lateral public.house_dues_terms(h.id) t on true
  where h.id = p_house_id;

  return v_out;
end;
$$;

revoke execute on function public.landlord_house_detail(uuid) from public, anon;
grant  execute on function public.landlord_house_detail(uuid) to authenticated;
