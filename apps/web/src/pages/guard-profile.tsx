import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Avatar, Card, Chip, Empty, HeadActions, Stat } from '../components/ui';
import {
  getGuardProfile,
  isFlagged,
  listEvents,
  listGuardShifts,
  type EventRow,
  type GuardProfile as Profile,
  type GuardShift,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { dayTime, outcomeLabel } from '../lib/format';
import { ago, count, duration } from '../lib/operator-format';

const SHIFT_COLS = 'grid grid-cols-[1fr_1fr_110px_140px] gap-4';
const EVENT_COLS = 'grid grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_120px] gap-4';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : null);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-extrabold tracking-label text-muted">{label}</div>
      <div className="mt-1 break-words text-[13px] font-semibold">{children ?? '—'}</div>
    </div>
  );
}

/**
 * One guard, as the estate admin sees them: who they are, whether they are
 * licensed and by whom placed, and how they have worked the gate.
 *
 * Codes never appear here, matching the audit log -- the activity list shows
 * outcomes and hosts, not the characters a resident sent their visitor.
 */
export function GuardProfile() {
  const { membershipId = '' } = useParams();
  const { activeEstateId, activeEstate } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [shifts, setShifts] = useState<GuardShift[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeEstateId || !membershipId) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const [p, s, e] = await Promise.all([
          getGuardProfile(activeEstateId, membershipId),
          listGuardShifts(activeEstateId, membershipId),
          listEvents(activeEstateId, 50, membershipId),
        ]);
        if (!live) return;
        setProfile(p);
        setShifts(s);
        setEvents(e);
        setError(null);
      } catch (err) {
        if (live) setError((err as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [activeEstateId, membershipId]);

  const back = (
    <Link to=".." relative="path" className="text-[12.5px] font-bold text-muted hover:text-ink">
      ← All guards
    </Link>
  );

  if (loading) {
    return (
      <>
        {back}
        <Card className="mt-4">
          <Empty>Loading…</Empty>
        </Card>
      </>
    );
  }

  if (error || !profile) {
    return (
      <>
        {back}
        <Card className="mt-4">
          {/* Not-found and not-yours look the same on purpose: the RPC returns
              no row for another estate's guard, and saying which would confirm
              the id exists. */}
          <Empty>{error ?? 'No guard with that id at this estate.'}</Empty>
        </Card>
      </>
    );
  }

  const p = profile;
  const licenceExpired = p.licence_expires_at !== null && new Date(p.licence_expires_at) < new Date();

  return (
    <>
      <div className="flex items-center justify-between">
        {back}
        <div className="flex items-center gap-2">
          <HeadActions estate={activeEstate?.estate_name ?? '—'} />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <Avatar name={p.full_name} className="h-14 w-14 rounded-[18px] text-[16px]" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-extrabold tracking-tight">{p.full_name}</h1>
          <div className="mt-1 text-[12.5px] text-muted">
            Guard since {date(p.joined_at)}
            {p.agency_name ? ` · placed by ${p.agency_name}` : ''}
          </div>
        </div>
        <div className="flex gap-2">
          {p.on_duty_since ? (
            <Chip tone="good">On duty · since {dayTime(p.on_duty_since)}</Chip>
          ) : null}
          {p.is_active ? <Chip tone="good">Active</Chip> : <Chip>Removed</Chip>}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-6 gap-3">
        <Stat label="VERIFIED · 30D" value={count(p.verifications_30d)} />
        <Stat label="ADMITTED" value={count(p.admitted_30d)} />
        <Stat label="REFUSED" value={count(p.rejected_30d)} />
        <Stat label="FLAGGED" value={count(p.flagged_30d)} tone={p.flagged_30d ? 'bad' : undefined} />
        <Stat label="HOURS ON DUTY" value={Number(p.hours_on_duty_30d).toLocaleString()} />
        <Stat label="SHIFTS" value={count(p.shifts_30d)} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="text-[10.5px] font-extrabold tracking-label text-muted">CONTACT & ACCOUNT</div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <Field label="PHONE">{p.phone}</Field>
            <Field label="SIGN-IN EMAIL">{p.email}</Field>
            <Field label="LAST SIGNED IN">
              {p.last_sign_in_at ? ago(p.last_sign_in_at) : 'Never — the account may not have been handed over'}
            </Field>
            <Field label="LAST AT THE GATE">
              {p.last_verification_at ? ago(p.last_verification_at) : 'No verifications yet'}
            </Field>
            <Field label="OFFLINE VERIFICATIONS · 30D">{count(p.offline_30d)}</Field>
            <Field label="LAST SHIFT STARTED">{p.last_shift_at ? dayTime(p.last_shift_at) : null}</Field>
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-[10.5px] font-extrabold tracking-label text-muted">LICENCE & AGENCY</div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <Field label="AGENCY">{p.agency_name ?? 'Employed by the estate directly'}</Field>
            <Field label="LICENCE NUMBER">{p.licence_number ?? 'Not recorded'}</Field>
            {/* Grades A-E are PSIRA's (South Africa); a Nigerian licence has none. */}
            {p.licence_grade ? <Field label="GRADE">{p.licence_grade}</Field> : null}
            <Field label="EXPIRES">
              {p.licence_expires_at ? (
                <span className={licenceExpired ? 'text-coral-ink' : undefined}>
                  {date(p.licence_expires_at)}
                  {licenceExpired ? ' · expired' : ''}
                </span>
              ) : null}
            </Field>
            <Field label="CHECKED BY THE AGENCY">
              {p.licence_verified_at ? date(p.licence_verified_at) : 'Not verified'}
            </Field>
          </div>
        </Card>
      </div>

      <h2 className="mt-[26px] text-[16.5px] font-extrabold tracking-tight">Shifts</h2>
      <Card className="mt-3.5 py-4">
        <div className={`${SHIFT_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>STARTED</span>
          <span>ENDED</span>
          <span>LENGTH</span>
          <span>HOW IT ENDED</span>
        </div>
        {shifts.length === 0 ? (
          <Empty>No shifts yet. A shift starts when the guard takes the gate in the guard app.</Empty>
        ) : (
          shifts.map((s) => {
            const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
            return (
              <div key={s.shift_id} className={`${SHIFT_COLS} items-center border-t border-hair px-4 py-3`}>
                <span className="text-[12.5px]">{dayTime(s.started_at)}</span>
                <span className="text-[12.5px] text-muted">{s.ended_at ? dayTime(s.ended_at) : '—'}</span>
                <span className="text-[12.5px] font-bold">
                  {duration((end - new Date(s.started_at).getTime()) / 1000)}
                </span>
                <span>
                  {!s.ended_at ? (
                    <Chip tone="good">On duty</Chip>
                  ) : s.ended_by_handover ? (
                    <Chip>Handed over</Chip>
                  ) : (
                    <Chip>Ended</Chip>
                  )}
                </span>
              </div>
            );
          })
        )}
      </Card>

      <h2 className="mt-[26px] text-[16.5px] font-extrabold tracking-tight">Recent verifications</h2>
      <Card className="mt-3.5 py-4">
        <div className={`${EVENT_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>WHEN</span>
          <span>OUTCOME</span>
          <span>HOST</span>
          <span></span>
        </div>
        {events.length === 0 ? (
          <Empty>This guard has not verified anything yet.</Empty>
        ) : (
          events.map((e) => (
            <div key={e.id} className={`${EVENT_COLS} items-center border-t border-hair px-4 py-3`}>
              <span className="text-[12.5px] text-muted">{dayTime(e.verified_at)}</span>
              <span className="truncate text-[13px] font-semibold">
                {outcomeLabel(e.outcome, e.reject_reason)}
              </span>
              <span className="truncate text-[12.5px] text-muted">
                {e.host_name ? `${e.host_name}${e.host_unit ? ` · ${e.host_unit}` : ''}` : '—'}
              </span>
              <span className="flex justify-end gap-1.5">
                {isFlagged(e) ? <Chip tone="bad">Flagged</Chip> : null}
                {e.source === 'offline_replay' ? <Chip>Offline</Chip> : null}
              </span>
            </div>
          ))
        )}
      </Card>
    </>
  );
}
