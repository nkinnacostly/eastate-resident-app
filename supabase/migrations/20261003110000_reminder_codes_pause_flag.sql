-- Estate Access Platform — dues reminders only threaten what is real
--
-- Every dues reminder told the reader that, if unpaid, nobody at the house could
-- generate new visitor codes. That is only true where the committee has switched
-- the rule on AND recorded what authorises it (20260927130000). Everywhere else
-- the email threatened a sanction the estate never adopted -- the exact thing the
-- authority requirement exists to prevent, and a statement a resident could
-- fairly hold the estate to.
--
-- The reminder now carries `codes_pause`, and the template states the
-- consequence only when it is true. Same signature, same grants; the body is
-- the previous one plus that field.

create or replace function public.send_dues_reminder(
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
  v_pause  boolean;
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

  select e.name, e.dues_enforcement_authorised_at is not null
    into v_estate, v_pause
    from public.estates e where e.id = c.estate_id;
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
        'charge_id',     c.id,
        -- Whether this estate has actually authorised pausing new visitor codes
        -- for arrears. The email only mentions that consequence when it is real.
        'codes_pause',   coalesce(v_pause, false)
      ));
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$$;

revoke execute on function public.send_dues_reminder(uuid, public.dues_reminder_kind, uuid)
  from public, anon, authenticated;
