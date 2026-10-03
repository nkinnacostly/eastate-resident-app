-- Estate Access Platform — a house's residents, as a table
--
-- The estate admin's house page lists its residents in a searchable, sortable,
-- paginated table. A table is only worth searching and sorting if each row
-- carries more than a name, so each resident now comes with their sign-in
-- email, last sign-in, live and recent codes, and whether their dues are in
-- arrears.
--
-- Additive: the residents objects gain keys and lose none, so the web build
-- already deployed keeps working against this, and this migration can (and
-- per .githooks/pre-push, must) land before the code that reads the new keys.
--
-- Same signature, same grants (the helper stays callable by no client role;
-- see 20261001150000). Only the residents list changes.

create or replace function private.house_detail(p_house_id uuid)
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
               'phone', p.phone, 'email', u.email, 'last_sign_in_at', u.last_sign_in_at,
               'is_active', m.is_active, 'joined_at', m.created_at,
               -- Live is DERIVED: an 'active' row past its expiry is not live.
               'live_codes', (select count(*) from public.access_codes c
                               where c.membership_id = m.id and c.status = 'active'
                                 and c.expires_at > now()),
               'codes_30d', (select count(*) from public.access_codes c
                              where c.membership_id = m.id
                                and c.created_at > now() - interval '30 days'),
               -- The same predicate the gate uses, so the table cannot say
               -- "paid up" about someone the gate is refusing.
               'in_arrears', public.dues_in_arrears(m.id))
             order by m.is_active desc, p.full_name), '[]'::jsonb)
        from public.memberships m
        join auth.users u on u.id = m.user_id
        left join public.profiles p on p.id = m.user_id
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
