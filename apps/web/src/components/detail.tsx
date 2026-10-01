import { formatMoney } from '@estate/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { dateLabel, dayTime, monthLabel, outcomeLabel } from '../lib/format';
import type { ChargeItem, GateEvent, ShiftItem } from '../lib/detail';
import { duration } from '../lib/operator-format';
import { Avatar, Card, Chip, Empty } from './ui';

/**
 * Building blocks for the detail pages on every dashboard. One set, so an
 * estate admin, the operator and an agency see a shift or a charge drawn the
 * same way -- two renderings of the same record are where "the dashboards
 * disagree" bug reports come from.
 */

/** Up one level. Relative, so it works under /estate and /agency mounts alike. */
export function BackLink({ label, to = '..' }: { label: string; to?: string }) {
  return (
    <Link to={to} relative="path" className="text-[12.5px] font-bold text-muted hover:text-ink">
      ← {label}
    </Link>
  );
}

export function DetailHead({
  name,
  sub,
  chips,
  right,
}: {
  name: string;
  sub?: ReactNode;
  chips?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mt-5 flex items-center gap-4">
      <Avatar name={name} className="h-14 w-14 rounded-[18px] text-[16px]" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[26px] font-extrabold tracking-tight">{name}</h1>
        {sub ? <div className="mt-1 text-[12.5px] text-muted">{sub}</div> : null}
      </div>
      {chips ? <div className="flex flex-wrap justify-end gap-2">{chips}</div> : null}
      {right}
    </div>
  );
}

export function Field({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-extrabold tracking-label text-muted">{label}</div>
      <div className="mt-1 break-words text-[13px] font-semibold">{children ?? '—'}</div>
    </div>
  );
}

export function FieldCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="text-[10.5px] font-extrabold tracking-label text-muted">{title}</div>
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">{children}</div>
    </Card>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-[26px] flex items-center justify-between">
      <h2 className="text-[16.5px] font-extrabold tracking-tight">{children}</h2>
      {right}
    </div>
  );
}

/** Loading, failed, or not found -- the three states every detail page has. */
export function DetailState({ back, children }: { back: ReactNode; children: ReactNode }) {
  return (
    <>
      {back}
      <Card className="mt-4">
        <Empty>{children}</Empty>
      </Card>
    </>
  );
}

const SHIFT_COLS = 'grid grid-cols-[minmax(0,1fr)_1fr_1fr_100px_130px] gap-4';

export function ShiftTable({ shifts, showEstate }: { shifts: ShiftItem[]; showEstate: boolean }) {
  const cols = showEstate ? SHIFT_COLS : 'grid grid-cols-[1fr_1fr_100px_130px] gap-4';
  return (
    <Card className="mt-3.5 py-4">
      <div className={`${cols} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
        {showEstate ? <span>ESTATE</span> : null}
        <span>STARTED</span>
        <span>ENDED</span>
        <span>LENGTH</span>
        <span>HOW IT ENDED</span>
      </div>
      {shifts.length === 0 ? (
        <Empty>No shifts recorded.</Empty>
      ) : (
        shifts.map((s, i) => {
          const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
          return (
            <div key={s.shift_id ?? i} className={`${cols} items-center border-t border-hair px-4 py-3`}>
              {showEstate ? <span className="truncate text-[12.5px] font-bold">{s.estate_name}</span> : null}
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
  );
}

const EVENT_COLS = 'grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_120px] gap-4';

/** Gate entries without codes. `verified_at` is shown; ordering came from the server clock. */
export function GateEventTable({ events, showEstate }: { events: GateEvent[]; showEstate: boolean }) {
  return (
    <Card className="mt-3.5 py-4">
      <div className={`${EVENT_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
        <span>WHEN</span>
        <span>OUTCOME</span>
        <span>HOST</span>
        <span>{showEstate ? 'ESTATE' : 'GUARD'}</span>
        <span></span>
      </div>
      {events.length === 0 ? (
        <Empty>No gate activity yet.</Empty>
      ) : (
        events.map((e) => (
          <div key={e.id} className={`${EVENT_COLS} items-center border-t border-hair px-4 py-3`}>
            <span className="text-[12.5px] text-muted">{dayTime(e.verified_at)}</span>
            <span className="truncate text-[13px] font-semibold">{outcomeLabel(e.outcome, e.reject_reason)}</span>
            <span className="truncate text-[12.5px] text-muted">
              {e.host_name ? `${e.host_name}${e.host_unit ? ` · ${e.host_unit}` : ''}` : '—'}
            </span>
            <span className="truncate text-[12.5px] text-muted">
              {showEstate ? e.estate_name : (e.guard_name ?? '—')}
            </span>
            <span className="flex justify-end gap-1.5">
              {e.flagged ? <Chip tone="bad">Flagged</Chip> : null}
              {e.source === 'offline_replay' ? <Chip>Offline</Chip> : null}
            </span>
          </div>
        ))
      )}
    </Card>
  );
}

const CHARGE_COLS = 'grid grid-cols-[110px_minmax(0,1fr)_120px_110px_100px] gap-4';

export function ChargeChip({ charge: c }: { charge: ChargeItem }) {
  if (c.status === 'paid') return <Chip tone="good">Paid</Chip>;
  if (c.status === 'waived') return <Chip>Waived</Chip>;
  return new Date(`${c.due_on}T00:00:00`) < new Date() ? <Chip tone="bad">Overdue</Chip> : <Chip>Open</Chip>;
}

export function ChargeTable({
  charges,
  who,
}: {
  charges: ChargeItem[];
  /** What the second column says about each charge. */
  who: (c: ChargeItem) => ReactNode;
}) {
  return (
    <Card className="mt-3.5 py-4">
      <div className={`${CHARGE_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
        <span>PERIOD</span>
        <span>BILLED TO</span>
        <span>AMOUNT</span>
        <span>DUE</span>
        <span>STATUS</span>
      </div>
      {charges.length === 0 ? (
        <Empty>No dues charges.</Empty>
      ) : (
        charges.map((c) => (
          <div key={c.charge_id} className={`${CHARGE_COLS} items-center border-t border-hair px-4 py-3`}>
            <span className="text-[12.5px] font-bold text-muted">{monthLabel(c.period)}</span>
            <span className="truncate text-[12.5px]">{who(c)}</span>
            <span className="text-[12.5px] font-bold">{formatMoney(c.amount_minor, c.currency)}</span>
            <span className="text-[12.5px] text-muted">{dateLabel(c.due_on)}</span>
            <span title={c.waive_reason ?? undefined}><ChargeChip charge={c} /></span>
          </div>
        ))
      )}
    </Card>
  );
}
