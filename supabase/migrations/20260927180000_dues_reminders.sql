-- Estate Access Platform — dues reminders
--
-- Two automatic reminders before a charge falls due (7 days, then 2), plus a
-- button for an admin to nudge someone now.
--
-- ─── Why a log table rather than a flag on the charge ────────────────────────
--
-- A `reminder_7d_sent boolean` on dues_charges would answer "did we send it"
-- and nothing else. What an estate is actually asked, when a resident says they
-- were never told, is WHEN and to WHOM — and in a house-billed estate those
-- differ: the same charge is chased at the landlord's address, not the
-- tenant's. So each send is a row.
--
-- It is also the idempotency key. The daily sweep and an admin pressing the
-- button can both fire for the same charge on the same day, and the unique
-- index is what makes the second one a no-op rather than a second email.

create type public.dues_reminder_kind as enum ('week_before', 'two_days_before', 'overdue', 'manual');

create table public.dues_reminders (
  id         uuid primary key default gen_random_uuid(),
  charge_id  uuid not null references public.dues_charges (id) on delete cascade,
  kind       public.dues_reminder_kind not null,

  -- Who it actually went to. Stored rather than re-derived, because the
  -- landlord on the house record may change and this has to stay a true record
  -- of what happened.
  sent_to    text not null,
  -- 'landlord' or 'resident'. The same charge legitimately generates both.
  recipient  text not null,

  sent_at    timestamptz not null default now(),
  -- Null for the scheduled ones. An admin nudge records who pressed it.
  sent_by_membership_id uuid references public.memberships (id),

  constraint dues_reminders_recipient_ck check (recipient in ('landlord', 'resident'))
);

-- One automatic reminder of each kind, per charge, per address. The scheduled
-- sweep is re-runnable and an admin cannot spam a landlord by pressing twice;
-- 'manual' is excluded because a second deliberate nudge a week later is a
-- legitimate thing for an admin to do.
create unique index dues_reminders_once_per_kind
  on public.dues_reminders (charge_id, kind, sent_to)
  where kind <> 'manual';

create index dues_reminders_charge_idx on public.dues_reminders (charge_id, sent_at desc);

alter table public.dues_reminders enable row level security;
grant select on public.dues_reminders to authenticated;

-- An estate admin sees their own estate's reminder history, which is the point:
-- "we told them on the 3rd and the 8th" is the answer to the dispute.
create policy "dues: admins read their estate's reminders" on public.dues_reminders
  for select to authenticated
  using (
    charge_id in (
      select c.id from public.dues_charges c
       where public.current_membership(c.estate_id, 'admin') is not null
    )
    or public.is_platform_admin()
  );

-- ─── Who should be told about a charge ───────────────────────────────────────
--
-- One definition, used by the sweep and the admin button alike, so a scheduled
-- reminder and a manual one can never disagree about where it goes.
--
-- A house charge goes to the landlord, because they are the one billed. A
-- resident charge goes to the resident. Where a house has residents AND a
-- landlord email, both are told: the landlord has to pay it and the tenant is
-- the one who will be locked out, and telling only one of them is how this
-- becomes an argument at a gate.

create function public.dues_reminder_recipients(p_charge_id uuid)
returns table (email text, name text, recipient text)
language sql
stable
security definer
set search_path = ''
as $$
  select h.landlord_email, h.landlord_name, 'landlord'
    from public.dues_charges c
    join public.houses h on h.id = c.house_id
   where c.id = p_charge_id
     and h.landlord_email is not null
     and btrim(h.landlord_email) <> ''

  union all

  -- Residents of the billed house.
  select u.email, p.full_name, 'resident'
    from public.dues_charges c
    join public.memberships m
      on m.house_id = c.house_id and m.role = 'resident' and m.is_active
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
   where c.id = p_charge_id
     and c.house_id is not null
     and u.email is not null

  union all

  -- The resident a charge is levied on directly.
  select u.email, p.full_name, 'resident'
    from public.dues_charges c
    join public.memberships m on m.id = c.membership_id
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
   where c.id = p_charge_id
     and c.membership_id is not null
     and u.email is not null;
$$;

revoke execute on function public.dues_reminder_recipients(uuid) from public, anon, authenticated;

-- ─── Sending ─────────────────────────────────────────────────────────────────
--
-- One function, used by the nightly sweep and the admin button alike. Enqueues
-- onto the existing `emails` queue rather than sending inline -- nothing in this
-- codebase talks to Resend from a transaction (§6.3), because a slow provider
-- would then hold a database transaction open.

create function public.send_dues_reminder(
  p_charge_id uuid,
  p_kind      public.dues_reminder_kind,
  p_actor     uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c        public.dues_charges%rowtype;
  r        record;
  v_estate text;
  v_house  text;
  v_sent   integer := 0;
begin
  select * into c from public.dues_charges where id = p_charge_id;
  if c.id is null then
    raise exception 'no_such_charge' using errcode = '42704';
  end if;

  -- Never chase a settled bill. Worth guarding here rather than only at the
  -- caller: the sweep selects open charges, but a payment landing between the
  -- select and the send is exactly the race that produces an angry email to
  -- somebody who has just paid.
  if c.status <> 'open' then
    return 0;
  end if;

  select e.name into v_estate from public.estates e where e.id = c.estate_id;
  select h.house_number into v_house from public.houses h where h.id = c.house_id;

  for r in select * from public.dues_reminder_recipients(p_charge_id) loop
    -- Claim first, send second. The unique index is what makes the sweep
    -- re-runnable and stops an admin double-tap producing two emails; ON
    -- CONFLICT DO NOTHING means the loser simply does not enqueue.
    insert into public.dues_reminders
      (charge_id, kind, sent_to, recipient, sent_by_membership_id)
    values (p_charge_id, p_kind, r.email, r.recipient, p_actor)
    on conflict do nothing;

    if found then
      perform pgmq.send('emails', jsonb_build_object(
        'kind',          'dues_reminder',
        'to',            r.email,
        'recipient_name', r.name,
        'recipient_role', r.recipient,
        'reminder_kind', p_kind::text,
        'estate_name',   coalesce(v_estate, 'Your estate'),
        'house_number',  v_house,
        'amount_minor',  c.amount_minor,
        'currency',      c.currency,
        'due_on',        c.due_on,
        -- The pay link goes ONLY to a landlord. A resident has the app, and a
        -- bearer link in a tenant's inbox is a bill they were not asked to pay.
        'pay_token',     case when r.recipient = 'landlord' then c.pay_token else null end,
        -- Carried so the dispatcher can build a stable idempotency key; Resend
        -- deduplicates on it for 24 hours, which turns the queue's
        -- at-least-once delivery into exactly-one-email.
        'charge_id',     c.id
      ));
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.send_dues_reminder(uuid, public.dues_reminder_kind, uuid)
  from public, anon, authenticated;

-- ─── The admin button ────────────────────────────────────────────────────────

create function public.remind_dues_charge(p_charge_id uuid)
returns integer
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

  return public.send_dues_reminder(p_charge_id, 'manual', v_admin);
end;
$$;

revoke execute on function public.remind_dues_charge(uuid) from public, anon;
grant  execute on function public.remind_dues_charge(uuid) to authenticated;

-- ─── The schedule ────────────────────────────────────────────────────────────
--
-- Seven days out, then two. Both measured against due_on, which already
-- includes the estate's grace period -- so "due" means the day the charge
-- starts blocking, which is the date the recipient actually cares about.

create function public.send_due_dues_reminders()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r      record;
  v_sent integer := 0;
begin
  for r in
    select c.id,
           case c.due_on - current_date
             when 7 then 'week_before'::public.dues_reminder_kind
             when 2 then 'two_days_before'::public.dues_reminder_kind
           end as kind
      from public.dues_charges c
      join public.estates e on e.id = c.estate_id
     where c.status = 'open'
       and c.due_on - current_date in (7, 2)
       -- An estate that does not bill through the app has nothing to chase.
       and e.dues_billing_mode <> 'none'
  loop
    v_sent := v_sent + public.send_dues_reminder(r.id, r.kind, null);
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.send_due_dues_reminders() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('send-dues-reminders');
exception when others then null;
end;
$$;

-- 08:00, once a day. Deliberately a civil hour rather than the small hours the
-- other jobs run at: this one produces mail that lands in somebody's inbox, and
-- a bill arriving at 03:00 reads as a machine shouting.
--
-- Exactly-once is the unique index's job, not the schedule's -- so a missed day
-- is recoverable by running it again, and a double run sends nothing twice.
select cron.schedule(
  'send-dues-reminders',
  '0 8 * * *',
  $$select public.send_due_dues_reminders()$$
);
