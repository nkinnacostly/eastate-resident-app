-- The reconciliation sweep: every unfinished payment gets its turn.
--
-- dues_payments_awaiting_verification returned the 200 OLDEST initiated
-- payments of the last three days, every tick. Anyone holding a pay link (or
-- any resident with an open charge) can start a checkout and abandon it, and
-- abandoned checkouts stay 'initiated'. Two hundred of them and the sweep sees
-- nothing else, ever: a genuine payment whose webhook was lost is never
-- credited, and the payer stays locked out of visitor codes for a debt they
-- paid. Ordinary abandoned checkouts at scale would do the same with no
-- attacker at all.
--
-- Now each call takes the payments checked LEAST recently and stamps them, so
-- however many there are, every one comes round again.
--
-- And 'failed' joins the sweep. Checkout allows retries under the same tx_ref,
-- and settle_dues_payment already lets a later success overwrite a recorded
-- failure — but only the webhook could deliver that success. If it was lost,
-- nothing ever asked Flutterwave again.

alter table public.dues_payments add column last_checked_at timestamptz;

drop function public.dues_payments_awaiting_verification(interval);

create function public.dues_payments_awaiting_verification(
  p_older_than interval default interval '10 minutes',
  p_limit      integer  default 200
)
returns table (tx_ref text, provider_tx_id text, created_at timestamptz)
language sql
volatile
security definer
set search_path = ''
as $$
  with picked as (
    select p.id
      from public.dues_payments p
     where p.status in ('initiated', 'failed')
       and p.created_at < now() - p_older_than
       -- A hosted checkout session lasts at most 24 hours, so anything older
       -- than a couple of days will never complete. Still verified rather than
       -- assumed, but not chased forever.
       and p.created_at > now() - interval '3 days'
     order by p.last_checked_at nulls first, p.created_at
     limit p_limit
     -- Two overlapping ticks take different rows rather than both verifying
     -- the same ones.
     for update skip locked
  )
  update public.dues_payments p
     set last_checked_at = now()
    from picked
   where p.id = picked.id
  returning p.tx_ref, p.provider_tx_id, p.created_at;
$$;
revoke execute on function public.dues_payments_awaiting_verification(interval, integer)
  from public, anon, authenticated;
