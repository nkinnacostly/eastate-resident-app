-- apply_retention's reason for keeping shifts four years, without PSIRA.
--
-- The comment above the shift cut justified the four years by South Africa's
-- PSIRA regulations. The product is built for Nigerian estates, and the
-- privacy policy now gives the operational reason instead: an estate, and any
-- security company guarding it, must be able to say who was on duty when an
-- incident is questioned long after it. The comment says the same.
--
-- Only that comment changes. The body is otherwise the live definition from
-- 20260926100000, byte for byte, and CREATE OR REPLACE keeps its grants (none
-- to any client role: it runs from cron) and its COMMENT.

create or replace function public.apply_retention()
 RETURNS TABLE(events_cleared integer, codes_deleted integer, shifts_cleared integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
