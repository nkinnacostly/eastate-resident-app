-- Estate Access Platform — retention
--
-- Until now nothing in this schema ever aged out. The gate log grew forever,
-- and so did every code string and every link back to the resident who minted
-- it. That was a deliberate-looking choice that nobody had actually decided.
--
-- Two requirements decide it for us, and they point in OPPOSITE directions,
-- which is the whole reason this file is more than one DELETE:
--
--   * South Africa's Information Regulator, in its draft Code of Conduct on
--     Gated Accesses (GG 54594, 30 April 2026), puts visitor registers and
--     access-control logs at 30-90 days, lists "indefinite retention of logs"
--     as non-compliant, and names "access Codes linked to individuals" as
--     personal information carrying a deletion obligation. Incident reports,
--     by contrast, it puts at 3-5 years.
--   * A guard's shift is an employment record -- which guard held which gate,
--     and when -- and an estate, and any security company guarding it under
--     contract, must still be able to account for who was on duty when an
--     incident is questioned long after it. That takes years, not days: four.
--
-- So a visitor's entry must go quickly and a guard's shift must not. Those are
-- different records with different owners, and one retention number cannot
-- serve both.
--
-- ─── De-identify, do not delete ───────────────────────────────────────────────
--
-- The estate's gate log is the thing it is legally keeping. Deleting rows would
-- destroy the register to protect the people in it, which satisfies nobody: the
-- admin loses the ability to answer "how many entries were refused in March"
-- and the visitor gains nothing they would not get from having their name cut.
--
-- POPIA s6(1)(b) puts information "de-identified to the extent that it cannot
-- be re-identified again" outside the Act entirely. So we cut the links and
-- keep the shell. What survives is "on this date, at this estate, an entry was
-- admitted / refused for this reason, against a pool this stale" -- a complete
-- access register with no person in it.
--
-- This is also already what we promise. The published privacy policy describes
-- exactly this mechanism for account deletion: "the link back to the individual
-- is cut, so the entry survives without identifying a person". This migration
-- makes the same thing happen on a clock instead of on request.

-- ─── 1. The window is per-estate, but bounded ────────────────────────────────
--
-- The draft code allows 30-90 days, and up to six months where the estate can
-- justify the risk. A CHECK rather than a plain default because the point of a
-- retention policy is that it cannot be opted out of: an estate may tune the
-- window inside the permitted band and cannot set it to "forever", which is
-- precisely the setting the Regulator has named as non-compliant.

alter table public.estates
  add column if not exists event_retention_days integer not null default 90;

alter table public.estates
  drop constraint if exists estates_event_retention_days_ck;

alter table public.estates
  add constraint estates_event_retention_days_ck
  check (event_retention_days between 30 and 180);

comment on column public.estates.event_retention_days is
  'Days before a gate event is de-identified. Bounded 30-180 by the SA draft '
  'gated-access code (30-90 ideal, up to 6 months where risk-justified). '
  'There is deliberately no value meaning "keep forever".';

-- ─── 2. Record that it happened ──────────────────────────────────────────────
--
-- Not decoration. Without it a cleared row is indistinguishable from a broken
-- one -- the dashboard would read a null guard as "Unknown guard", which
-- invites someone to go looking for a bug. It is also the evidence that the
-- policy ran, which is the first thing an auditor asks for.

alter table public.verification_events
  add column if not exists de_identified_at timestamptz;

comment on column public.verification_events.de_identified_at is
  'When the links to the guard, the code and the resident were cut. The event '
  'itself is kept: it is the estate''s access register.';

-- The guard link has to become nullable for any of this to be possible. The
-- dedupe key spans it -- unique (verified_by_membership_id, client_event_id) --
-- and Postgres treats NULLs as distinct, so several cleared rows coexist
-- happily. Dedupe is not weakened in practice either: replay only ever happens
-- from a guard's outbox, whose rows are minutes old, never months.
alter table public.verification_events
  alter column verified_by_membership_id drop not null;

-- Same for shifts, for the same reason, on a much longer clock (see below).
alter table public.guard_shifts
  add column if not exists de_identified_at timestamptz;

alter table public.guard_shifts
  alter column membership_id drop not null;

-- Without these the sweep is a sequential scan of the whole table every night,
-- growing with the log it is meant to bound. Partial, because a row that has
-- already been cleared is never a candidate again.
create index if not exists verification_events_retention_idx
  on public.verification_events (estate_id, synced_at)
  where de_identified_at is null;

create index if not exists guard_shifts_retention_idx
  on public.guard_shifts (started_at)
  where de_identified_at is null;

-- ─── 3. The sweep ────────────────────────────────────────────────────────────

create or replace function public.apply_retention()
returns table (events_cleared integer, codes_deleted integer, shifts_cleared integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_events  integer;
  v_flagged integer;
  v_codes   integer;
  v_shifts  integer;
begin
  -- (a) Ordinary gate events, past their estate's own window.
  --
  -- code_attempted goes with the rest. It is the one field that looks harmless
  -- and is not: the draft code names "access Codes linked to individuals" as
  -- personal information, and a code plus a timestamp re-identifies the
  -- resident who minted it for anyone holding a copy of the codes table.
  --
  -- Flagged entries are excluded here and handled in (b). A guard admitting
  -- somebody with no matching code IS the incident report, and stripping the
  -- guard's name off it after ninety days would destroy the only record of who
  -- made that call.
  update public.verification_events e
     set verified_by_membership_id = null,
         code_id                   = null,
         code_attempted            = null,
         de_identified_at          = now()
    from public.estates s
   where s.id = e.estate_id
     and e.de_identified_at is null
     and e.admitted_without_match = false
     and e.synced_at < now() - make_interval(days => s.event_retention_days);
  get diagnostics v_events = row_count;

  -- (b) Flagged entries: three years, the floor of the draft code's 3-5 year
  -- band for incident reports.
  update public.verification_events
     set verified_by_membership_id = null,
         code_id                   = null,
         code_attempted            = null,
         de_identified_at          = now()
   where de_identified_at is null
     and admitted_without_match = true
     and synced_at < now() - interval '3 years';
  -- GET DIAGNOSTICS takes a bare target, not an expression, so the running
  -- total is added separately.
  get diagnostics v_flagged = row_count;
  v_events := v_events + v_flagged;

  -- (c) Codes nothing points at any more.
  --
  -- Deleted outright rather than de-identified, because unlike an event a dead
  -- code has no residual value to the estate -- it is not part of the access
  -- register, it is the token the register refers to. Once (a) and (b) have cut
  -- the last reference, the row is only a code string attached to a resident.
  --
  -- NOT EXISTS rather than a join: a flagged event three years from expiry
  -- still holds its code_id, and deleting out from under it would either
  -- violate the foreign key or silently blank the evidence.
  delete from public.access_codes c
   using public.estates s
   where s.id = c.estate_id
     and c.created_at < now() - make_interval(days => s.event_retention_days)
     and not exists (
       select 1 from public.verification_events e where e.code_id = c.id
     );
  get diagnostics v_codes = row_count;

  -- (d) Shifts: four years, and the long clock is the point.
  --
  -- A shift is an employment record, not visitor data -- which guard held which
  -- gate, and when -- so the visitor-data windows above do not reach it. It
  -- stays linked to the guard for four years so that an estate, and any
  -- security company guarding it under contract, can still account for who was
  -- on duty when a question about an incident comes up long after it. The
  -- privacy policy (apps/site/privacy.html, "How long we keep it") says the same.
  update public.guard_shifts
     set membership_id    = null,
         de_identified_at = now()
   where de_identified_at is null
     and started_at < now() - interval '4 years';
  get diagnostics v_shifts = row_count;

  return query select v_events, v_codes, v_shifts;
end;
$$;

comment on function public.apply_retention() is
  'Nightly de-identification of aged gate data. Cuts links, keeps the register.';

-- Functions are EXECUTE-to-PUBLIC by default, so an unrevoked definer function
-- is anon-callable -- and this one rewrites the audit log.
revoke execute on function public.apply_retention() from public, anon, authenticated;

-- ─── 4. Schedule ─────────────────────────────────────────────────────────────

do $$
begin
  perform cron.unschedule('apply-retention');
exception
  when others then null;  -- not scheduled yet
end;
$$;

-- 03:40, off the hour: every cron on the box firing at :00 is how a nightly
-- job becomes a nightly outage.
select cron.schedule(
  'apply-retention',
  '40 3 * * *',
  $$select public.apply_retention()$$
);
