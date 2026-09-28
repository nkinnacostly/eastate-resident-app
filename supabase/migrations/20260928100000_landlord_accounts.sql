-- Estate Access Platform — landlords get an account and a dashboard
--
-- Until now a landlord was purely DATA: name, phone and email on the house,
-- with a comment saying outright that they never sign in. Everything they
-- needed arrived as a per-charge bearer link in an email. That worked while a
-- landlord owned one house. It stops working at three: three emails, three
-- payments, no history, and no way to see what they have already settled.
--
-- ─── How a landlord is linked to a house ────────────────────────────────────
--
-- BY THEIR CONFIRMED EMAIL MATCHING houses.landlord_email. Nothing else.
--
-- That is not a shortcut, it is the existing designation. An estate admin
-- already types the landlord's address onto the house, and today whoever
-- controls that inbox receives a link that pays the bill. Keying an account on
-- the same address is therefore NO WEAKER than what is already shipped, and
-- strictly stronger in one respect: nothing payable sits in an inbox waiting
-- to be forwarded.
--
-- `email_confirmed_at is not null` is load-bearing and not decoration. Without
-- it, anyone could sign up claiming someone else's address and read that
-- person's property portfolio before ever proving they can receive mail there.
--
-- ─── Why this is derived, not a table ───────────────────────────────────────
--
-- The obvious alternative is a house_landlords link table. It would need
-- keeping in sync with landlord_email forever, and the two would eventually
-- disagree -- at which point the estate's own record says one thing and the
-- login says another, with no way to tell which is right.
--
-- Derived means there is one fact. An admin correcting a typo moves access
-- immediately. A landlord selling a house loses it the moment the admin
-- records the new owner. Nothing to reconcile, nothing to leak.
--
-- The honest cost: a landlord who changes the email on their ACCOUNT loses
-- access until the estate records the new one. That is the correct direction
-- of authority -- the estate says who owns the house, not the person claiming
-- to -- and the dashboard says so rather than leaving them guessing.
--
-- ─── What a landlord may NOT see ────────────────────────────────────────────
--
-- Charges belonging to their tenants. Where a house bills its RESIDENTS, each
-- resident owes their own dues and the landlord owes nothing; what the people
-- living there do or do not owe is between them and the estate. Every query
-- below is restricted to charges raised against the HOUSE.

-- ─── Who is asking, and have they proved it ─────────────────────────────────

create function public.current_verified_email()
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
     and coalesce(btrim(u.email), '') <> '';
$$;

revoke execute on function public.current_verified_email() from public, anon, authenticated;

-- ─── Does this account own anything? ────────────────────────────────────────
--
-- The dashboard's router needs this before it can decide where to send
-- somebody, and it must be cheap: it runs on every page load.

create function public.is_landlord()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.houses h
      join public.estates e on e.id = h.estate_id
     where e.is_active
       and h.is_active
       and lower(btrim(h.landlord_email)) = public.current_verified_email()
  );
$$;

revoke execute on function public.is_landlord() from public, anon;
grant  execute on function public.is_landlord() to authenticated;

comment on function public.is_landlord is
  'True when this account''s CONFIRMED email is recorded as the landlord of at '
  'least one active house. Ownership is asserted by the estate, never by the '
  'person claiming it.';

-- ─── The portfolio ──────────────────────────────────────────────────────────
--
-- Every house this landlord owns, across every estate. One landlord commonly
-- owns in more than one estate, and making them pick an estate first would be
-- asking them to know something the app already knows.

create function public.my_landlord_houses()
returns table (
  house_id       uuid,
  house_number   text,
  house_code     text,
  estate_id      uuid,
  estate_name    text,
  dues_payer     public.house_dues_payer,
  dues_amount_minor bigint,
  currency       text,
  /** How many people live there. A count, never who they are. */
  residents      integer,
  outstanding_minor bigint,
  overdue_minor  bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    h.id, h.house_number, h.house_code,
    e.id, e.name,
    t.payer, t.amount_minor, e.dues_currency,
    (select count(*)::integer from public.memberships m
      where m.house_id = h.id and m.role = 'resident' and m.is_active),
    -- Only charges raised against the HOUSE. Where the residents are billed,
    -- the landlord owes nothing and their tenants' debts are not theirs to
    -- read.
    coalesce((select sum(c.amount_minor) from public.dues_charges c
               where c.house_id = h.id and c.status = 'open'), 0)::bigint,
    coalesce((select sum(c.amount_minor) from public.dues_charges c
               where c.house_id = h.id and c.status = 'open'
                 and c.due_on < current_date), 0)::bigint
  from public.houses h
  join public.estates e on e.id = h.estate_id
  -- LEFT, because a house in an estate that does not bill still belongs to
  -- this landlord and still belongs on their dashboard. house_dues_terms
  -- returns no row there, and an inner join would make the house vanish.
  left join lateral public.house_dues_terms(h.id) t on true
 where e.is_active
   and h.is_active
   and lower(btrim(h.landlord_email)) = public.current_verified_email()
 order by e.name, h.house_number;
$$;

revoke execute on function public.my_landlord_houses() from public, anon;
grant  execute on function public.my_landlord_houses() to authenticated;

-- ─── What they owe, and what they have paid ─────────────────────────────────

create function public.landlord_dues()
returns table (
  charge_id    uuid,
  house_id     uuid,
  house_number text,
  estate_name  text,
  period       date,
  amount_minor bigint,
  currency     text,
  due_on       date,
  status       public.dues_charge_status,
  is_overdue   boolean,
  paid_at      timestamptz,
  waive_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id, h.id, h.house_number, e.name,
    c.period, c.amount_minor, c.currency, c.due_on, c.status,
    (c.status = 'open' and c.due_on < current_date),
    c.paid_at, c.waive_reason
  from public.dues_charges c
  join public.houses h on h.id = c.house_id
  join public.estates e on e.id = h.estate_id
 where lower(btrim(h.landlord_email)) = public.current_verified_email()
 order by c.status = 'open' desc, c.period desc
 limit 300;
$$;

revoke execute on function public.landlord_dues() from public, anon;
grant  execute on function public.landlord_dues() to authenticated;

-- ─── Paying from the dashboard ──────────────────────────────────────────────
--
-- The same shape as start_dues_payment, and deliberately so: one amount read
-- from the charge row inside the database, one fresh reference per attempt,
-- and the estate's settlement subaccount travelling with it so the money
-- settles to the estate and never to us.
--
-- Identity comes from auth.uid() by way of the confirmed email. p_charge_id is
-- client-supplied and therefore proves nothing on its own -- the ownership
-- check below is what stops one landlord naming another's charge.

create function public.start_landlord_dues_payment(p_charge_id uuid)
returns table (ok boolean, reason text, tx_ref text, amount_minor bigint, currency text,
               subaccount_ref text, fee_percent numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c       public.dues_charges%rowtype;
  v_email text := public.current_verified_email();
  v_ref   text;
  v_sub   text;
  v_fee   numeric;
  v_owns  boolean;
begin
  if v_email is null then
    return query select false, 'email_not_confirmed'::text, null::text, null::bigint,
                        null::text, null::text, null::numeric;
    return;
  end if;

  select * into c from public.dues_charges where id = p_charge_id;
  if c.id is null then
    return query select false, 'no_such_charge'::text, null::text, null::bigint,
                        null::text, null::text, null::numeric;
    return;
  end if;

  -- Theirs, and a HOUSE charge. A landlord may not settle a resident's
  -- personal dues even at their own property: it is not their debt, and
  -- paying it would tell them what that resident owed.
  select exists (
    select 1 from public.houses h
     where h.id = c.house_id
       and lower(btrim(h.landlord_email)) = v_email
  ) into v_owns;

  if c.house_id is null or not v_owns then
    return query select false, 'not_your_charge'::text, null::text, null::bigint,
                        null::text, null::text, null::numeric;
    return;
  end if;

  if c.status <> 'open' then
    return query select false, 'charge_not_open'::text, null::text, null::bigint,
                        null::text, null::text, null::numeric;
    return;
  end if;

  select e.settlement_subaccount_ref, e.platform_fee_percent
    into v_sub, v_fee
    from public.estates e where e.id = c.estate_id;

  -- Taking money with nowhere to send it is worse than refusing it.
  if v_sub is null then
    return query select false, 'estate_has_no_settlement_account'::text, null::text,
                        null::bigint, null::text, null::text, null::numeric;
    return;
  end if;

  v_ref := 'dues-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.dues_payments
    (charge_id, tx_ref, amount_minor, currency, payer_email)
  values
    (c.id, v_ref, c.amount_minor, c.currency, v_email);

  return query select true, null::text, v_ref, c.amount_minor, c.currency,
                      v_sub, coalesce(v_fee, 0);
end;
$$;

revoke execute on function public.start_landlord_dues_payment(uuid) from public, anon;
grant  execute on function public.start_landlord_dues_payment(uuid) to authenticated;

-- ─── Letting a landlord read the estates they own in ────────────────────────
--
-- The dashboard shows an estate's NAME beside each house. Without a policy a
-- landlord cannot read `estates` at all, and the definer functions above would
-- be the only route -- which is fine for them, but the moment a screen needs
-- anything else about the estate it would silently return nothing.
--
-- Scoped to the estates they actually own property in, and nothing more.

create policy "landlords read estates they own property in" on public.estates
  for select to authenticated
  using (
    exists (
      select 1 from public.houses h
       where h.estate_id = estates.id
         and h.is_active
         and lower(btrim(h.landlord_email)) = public.current_verified_email()
    )
  );
