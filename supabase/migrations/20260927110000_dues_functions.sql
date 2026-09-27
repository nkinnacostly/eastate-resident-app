-- Estate Access Platform — dues: raising charges, the gate, and settlement

-- ─── Is this resident blocked? ───────────────────────────────────────────────
--
-- Computed from the ledger on every call, never read off a cached
-- `is_delinquent` flag. A flag maintained by a nightly job is wrong for exactly
-- as long as it takes the job to run: a resident who pays at 09:00 would stay
-- locked out until midnight, which is the moment they are standing at the gate
-- with a visitor and the reason they paid.
--
-- ARREARS, not "this month is unpaid". The test is whether any charge is past
-- its due date and still open, so last month's unpaid dues keep blocking and
-- this month's do not until the grace period lapses.

create function public.dues_in_arrears(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case e.dues_billing_mode
    when 'none' then false

    -- Any resident of a paid-up house may mint. The charge is the house's, so
    -- a tenant is not punished for a landlord's arrears any more than they are
    -- rewarded for paying twice -- the house is either settled or it is not.
    when 'per_house' then
      m.house_id is not null and exists (
        select 1 from public.dues_charges c
         where c.house_id = m.house_id
           and c.status = 'open'
           and c.due_on < current_date)

    when 'per_resident' then exists (
      select 1 from public.dues_charges c
       where c.membership_id = m.id
         and c.status = 'open'
         and c.due_on < current_date)
  end
  from public.memberships m
  join public.estates e on e.id = m.estate_id
  where m.id = p_membership_id;
$$;

comment on function public.dues_in_arrears(uuid) is
  'True when an overdue unpaid charge covers this membership. Derived live '
  'from the ledger: a cached flag would keep a resident locked out until the '
  'next sweep, which is precisely when they are standing at the gate.';

-- house_id is nullable -- it postdates memberships, and backfilled rows may not
-- have one. Note the `m.house_id is not null` guard above: a resident with no
-- house on record is NOT blocked. Locking someone out of their own gate because
-- of a data gap in our schema is the wrong way to fail.

-- ─── Raising the monthly charges ─────────────────────────────────────────────

create function public.generate_dues_charges(
  p_period date default date_trunc('month', current_date)::date
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
  -- Per house.
  insert into public.dues_charges
    (estate_id, period, house_id, amount_minor, currency, due_on)
  select e.id, v_period, h.id, e.dues_amount_minor, e.dues_currency,
         v_period + e.dues_grace_days
    from public.estates e
    join public.houses h on h.estate_id = e.id and h.is_active
   where e.dues_billing_mode = 'per_house'
     and e.is_active
  -- Re-running the month is a no-op rather than a double-bill. That property
  -- is what makes this safe to invoke by hand after a failed cron, which is
  -- the situation it will actually be used in.
  on conflict do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  -- Per resident.
  insert into public.dues_charges
    (estate_id, period, membership_id, amount_minor, currency, due_on)
  select e.id, v_period, m.id, e.dues_amount_minor, e.dues_currency,
         v_period + e.dues_grace_days
    from public.estates e
    join public.memberships m
      on m.estate_id = e.id and m.role = 'resident' and m.is_active
   where e.dues_billing_mode = 'per_resident'
     and e.is_active
  on conflict do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  return v_count;
end;
$$;

revoke execute on function public.generate_dues_charges(date) from public, anon, authenticated;

-- A resident who joins on the 20th is charged for that month in full on their
-- next run, not prorated. Deliberate: a part-month levy is a conversation
-- between a resident and their estate, and inventing one in software would
-- produce an amount nobody agreed to. An admin can waive instead, which leaves
-- a record of the decision.

do $$
begin
  perform cron.unschedule('generate-dues-charges');
exception when others then null;
end;
$$;

-- 02:10 on the 1st. Before the retention sweep, and well clear of it.
select cron.schedule(
  'generate-dues-charges',
  '10 2 1 * *',
  $$select public.generate_dues_charges()$$
);

-- ─── The gate ────────────────────────────────────────────────────────────────
--
-- CREATE OR REPLACE, same signature. The body is restated in full because
-- Postgres has no way to patch one; every line except the dues block is
-- unchanged from 20260820100000.

create or replace function public.mint_access_code(
  p_estate_id     uuid,
  p_is_delivery   boolean default false,
  p_delivery_note text    default null
)
returns table (result text, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_limit    constant integer := 10;   -- requests per minute (§3.2)
  v_note_max constant integer := 200;  -- mirrors MAX_DELIVERY_NOTE_LENGTH
  v_live     integer;
  v_hits     integer;
  v_code     text;
  v_expires  timestamptz := now() + interval '6 hours';
  v_attempt  integer := 0;
  v_delivery boolean := coalesce(p_is_delivery, false);
  v_note     text;
begin
  -- identity from the JWT, never from an argument
  v_membership_id := public.current_membership(p_estate_id, 'resident');

  if v_membership_id is null then
    return query select 'not_a_resident'::text, null::text, null::timestamptz;
    return;
  end if;

  -- serialize minting for THIS membership; released at commit, never contends
  -- across residents
  perform pg_advisory_xact_lock(hashtextextended(v_membership_id::text, 0));

  -- rate limit: count this attempt whatever its outcome (§3.2)
  insert into public.code_mint_attempts (membership_id, window_start, hits)
  values (v_membership_id, date_trunc('minute', now()), 1)
  on conflict (membership_id, window_start)
  do update set hits = code_mint_attempts.hits + 1
  returning hits into v_hits;

  if v_hits > v_limit then
    return query select 'rate_limited'::text, null::text, null::timestamptz;
    return;
  end if;

  -- THE DUES GATE.
  --
  -- After the rate limiter, like every other check here, so that a client
  -- looping against a locked account still advances the counter -- the same
  -- inversion the no-RAISE rule exists to avoid.
  --
  -- Before the code-limit check, because when both are true this is the one the
  -- resident can act on. "You already have 3 codes" sends them to a screen that
  -- will not help; "your dues are unpaid" sends them to the one that will.
  --
  -- A RESULT, never an exception. Raising here would roll back the rate-limit
  -- counter along with it (Technical Design §3.1), so an account in arrears
  -- would get unlimited free attempts -- the exact bug the locked decision
  -- about counters exists to prevent.
  if public.dues_in_arrears(v_membership_id) then
    return query select 'dues_unpaid'::text, null::text, null::timestamptz;
    return;
  end if;

  v_note := nullif(btrim(coalesce(p_delivery_note, '')), '');

  if not v_delivery then
    v_note := null;
  end if;

  if v_note is not null and char_length(v_note) > v_note_max then
    return query select 'note_too_long'::text, null::text, null::timestamptz;
    return;
  end if;

  select count(*) into v_live
    from public.access_codes ac
   where ac.membership_id = v_membership_id
     and ac.status = 'active'
     and ac.expires_at > now();

  if v_live >= 3 then
    return query select 'code_limit_reached'::text, null::text, null::timestamptz;
    return;
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_code(6);
    begin
      insert into public.access_codes
        (code, estate_id, membership_id, status, expires_at, is_delivery, delivery_note)
      values
        (v_code, p_estate_id, v_membership_id, 'active', v_expires, v_delivery, v_note);

      return query select 'ok'::text, v_code, v_expires;
      return;
    exception when unique_violation then
      if v_attempt >= 5 then
        return query select 'code_collision'::text, null::text, null::timestamptz;
        return;
      end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.mint_access_code(uuid, boolean, text) from public, anon;
grant  execute on function public.mint_access_code(uuid, boolean, text) to authenticated;

-- ─── What a resident owes ────────────────────────────────────────────────────

create function public.my_dues(p_estate_id uuid)
returns table (
  charge_id     uuid,
  period        date,
  amount_minor  bigint,
  currency      text,
  due_on        date,
  status        public.dues_charge_status,
  is_overdue    boolean,
  billing_mode  public.dues_billing_mode,
  subject       text,
  pay_token     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership uuid := public.current_membership(p_estate_id, 'resident');
  v_house      uuid;
  v_mode       public.dues_billing_mode;
begin
  if v_membership is null then
    raise exception 'not_a_resident' using errcode = '42501';
  end if;

  select m.house_id, e.dues_billing_mode into v_house, v_mode
    from public.memberships m join public.estates e on e.id = m.estate_id
   where m.id = v_membership;

  return query
  select c.id, c.period, c.amount_minor, c.currency, c.due_on, c.status,
         (c.status = 'open' and c.due_on < current_date),
         v_mode,
         case when c.house_id is not null then 'house' else 'resident' end,
         -- The pay token is returned to the resident too, not only emailed to
         -- the landlord. In a per-house estate a tenant often settles it and
         -- squares up privately; withholding the link would force them through
         -- the landlord for no reason we have any business enforcing.
         c.pay_token
    from public.dues_charges c
   where c.estate_id = p_estate_id
     and ((v_mode = 'per_house'    and c.house_id = v_house)
       or (v_mode = 'per_resident' and c.membership_id = v_membership))
   order by c.period desc
   limit 24;
end;
$$;

revoke execute on function public.my_dues(uuid) from public, anon;
grant  execute on function public.my_dues(uuid) to authenticated;

-- ─── Waiving ─────────────────────────────────────────────────────────────────

create function public.waive_dues_charge(p_charge_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_estate uuid;
  v_admin  uuid;
begin
  select estate_id into v_estate from public.dues_charges where id = p_charge_id;
  if v_estate is null then
    raise exception 'no_such_charge' using errcode = '42704';
  end if;

  v_admin := public.current_membership(v_estate, 'admin');
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'waive_reason_required' using errcode = '22023';
  end if;

  -- Only an OPEN charge. Waiving one already paid would leave money received
  -- against a debt the ledger says was forgiven, which is the kind of thing
  -- that surfaces a year later during an audit.
  update public.dues_charges
     set status = 'waived', waived_at = now(),
         waived_by_membership_id = v_admin, waive_reason = btrim(p_reason)
   where id = p_charge_id and status = 'open';

  if not found then
    raise exception 'charge_not_open' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.waive_dues_charge(uuid, text) from public, anon;
grant  execute on function public.waive_dues_charge(uuid, text) to authenticated;
