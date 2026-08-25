-- Estate Access Platform — self-service password reset
--
-- WHY THIS EXISTS AT ALL, GIVEN SUPABASE AUTH ALREADY HAS /auth/v1/recover
--
-- It still does, and it is still what mints the token. What it cannot do here
-- is DELIVER the message: the project has no Send Email Hook enabled, so
-- recover falls back to Supabase's built-in sender — roughly two mails an hour,
-- a default template with no code in it, and a link whose redirect_to is the
-- CLI default `http://localhost:3000`, which is a dead address on a phone.
--
-- So the request-password-reset Edge Function mints the token with the admin
-- API and sends it through Resend, on the verified domain, using the template
-- already in this repo. That is not a new pattern — onboard-estate has done
-- generateLink + our own email since the estate-admin welcome was written.
--
-- The cost of owning delivery is owning the abuse surface that came free with
-- GoTrue's endpoint, which is what this migration is: a rate limiter, so a
-- public endpoint that sends mail on demand cannot be turned into a mail
-- cannon aimed at somebody else's inbox.

create table public.password_reset_attempts (
  id           bigserial   primary key,
  -- The address as typed, normalised. NOT a foreign key to a user: the whole
  -- point is to also count attempts against addresses that have no account,
  -- since those are exactly what a probe looks like.
  email_key    text        not null,
  requested_at timestamptz not null default now()
);

create index password_reset_attempts_lookup
  on public.password_reset_attempts (email_key, requested_at desc);

-- RLS on, and deliberately NO policies and no grants. Same reasoning as
-- access_codes and verification_events: the only reachable path is a
-- SECURITY DEFINER function, so there is nothing to get a policy wrong about.
-- A client that could read this table could enumerate which addresses have
-- asked for a reset, which is precisely what the endpoint refuses to disclose.
alter table public.password_reset_attempts enable row level security;

-- ─── The limiter ─────────────────────────────────────────────────────────────
--
-- Returns a STATUS, never raises. This is the same rule that mint_access_code
-- is built on and for the same reason: `raise` aborts the transaction, and the
-- attempt row would roll back with it — so the limiter would only ever count
-- attempts it had already allowed, and a caller who is being refused would
-- reset their own budget on every try.
--
-- The insert therefore happens BEFORE the decision is returned, and the count
-- is taken BEFORE the insert. A refused attempt still costs the caller a slot.

create function public.claim_password_reset(p_email text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Five an hour. Comfortably above a real person who mistypes their address,
  -- fetches the mail, and asks again because it landed in spam; far below
  -- anything that would make this worth pointing at a stranger.
  v_limit constant integer := 5;
  v_key   text;
  v_hits  integer;
begin
  -- Normalised so `Rita@Example.com ` and `rita@example.com` share a budget.
  -- Without this the limit is bypassed by varying the capitalisation.
  v_key := lower(btrim(coalesce(p_email, '')));
  if v_key = '' then
    return 'rate_limited';
  end if;

  -- Serialise concurrent requests for the SAME address before counting.
  -- Under READ COMMITTED two simultaneous requests each snapshot at statement
  -- start, so both see the same count and both pass — the identical phantom
  -- that makes the 3-code cap need a lock (Technical Design §3.1).
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  select count(*) into v_hits
    from public.password_reset_attempts a
   where a.email_key = v_key
     and a.requested_at > now() - interval '1 hour';

  insert into public.password_reset_attempts (email_key) values (v_key);

  if v_hits >= v_limit then
    return 'rate_limited';
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.claim_password_reset(text) from public, anon, authenticated;
grant  execute on function public.claim_password_reset(text) to service_role;

-- ─── Purge ───────────────────────────────────────────────────────────────────
--
-- The limiter only ever looks an hour back, so anything older is dead weight.
-- Kept for a day rather than an hour so the table is still useful evidence if
-- someone asks why an address was being refused.
--
-- A daily cron rather than a delete inside claim_password_reset: doing it on
-- the request path would make the person asking for a reset pay for a scan of
-- everybody else's rows, while holding an advisory lock.

create function public.purge_password_reset_attempts()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.password_reset_attempts
   where requested_at < now() - interval '1 day';
$$;

revoke execute on function public.purge_password_reset_attempts() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('purge-password-reset-attempts');
exception
  when others then null;  -- not scheduled yet
end;
$$;

select cron.schedule(
  'purge-password-reset-attempts',
  '17 4 * * *',
  $$select public.purge_password_reset_attempts()$$
);
