import { useCallback, useEffect, useState } from 'react';

import { HeadActions, Card, Chip, Empty, PageHead } from '../components/ui';
import { listEvents, type EventRow } from '../lib/api';
import { useAuth } from '../lib/auth';
import { clock, dayTime, outcomeLabel } from '../lib/format';

const COLS = 'grid grid-cols-[110px_100px_1.3fr_1fr_1fr_100px] gap-4';
const FILTERS = ['All', 'Admitted', 'Refused', 'Flagged'] as const;

export function Audit() {
  const { activeEstateId, activeEstate } = useAuth();
  const [rows, setRows] = useState<EventRow[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    try {
      setRows(await listEvents(activeEstateId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeEstateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = rows.filter((e) => {
    // 'flagged' is not an outcome the server stores — it is an admitted event
    // that arrived from a device with no matching code (source offline_replay,
    // no code_id). Derive it rather than inventing a column.
    const flagged = e.outcome === 'admitted' && e.source === 'offline_replay' && !e.host_name;
    const match =
      filter === 'All' ||
      (filter === 'Admitted' && e.outcome === 'admitted' && !flagged) ||
      (filter === 'Refused' && (e.outcome === 'rejected' || e.outcome === 'collision')) ||
      (filter === 'Flagged' && flagged);
    if (!match) return false;
    if (!q.trim()) return true;
    const hay = `${e.code ?? ''} ${e.guard_name} ${e.host_name ?? ''} ${e.host_unit ?? ''}`;
    return hay.toLowerCase().includes(q.trim().toLowerCase());
  });

  return (
    <>
      <PageHead
        title="Audit log"
        blurb="Every verification made at this estate: the code, the guard, the device time, and whether it reached the server. Records are append-only — nothing here can be edited or deleted."
        right={<HeadActions estate={activeEstate?.estate_name ?? '—'} />}
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-2.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a code, guard or resident"
          className="h-11 flex-1 rounded-[14px] bg-field px-4 text-[13px] outline-none focus:ring-2 focus:ring-lime"
        />
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`h-11 rounded-chip px-4 text-[12px] font-bold ${
              f === filter ? 'bg-ink text-canvas' : 'bg-field text-muted'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <Card className="mt-3.5 py-4">
        <div className={`${COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>TIME</span>
          <span>CODE</span>
          <span>OUTCOME</span>
          <span>GUARD</span>
          <span>HOST</span>
          <span>SYNC</span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : shown.length === 0 ? (
          <Empty>No entries{filter === 'All' ? ' yet' : ` matching ${filter.toLowerCase()}`}.</Empty>
        ) : (
          shown.map((e) => {
            const flagged =
              e.outcome === 'admitted' && e.source === 'offline_replay' && !e.host_name;
            return (
              <div key={e.id} className={`${COLS} items-center border-t border-hair px-4 py-3`}>
                {/* verified_at is what a human reads; synced_at is what SORTS. */}
                <div className="text-[12.5px] font-bold text-muted">{dayTime(e.verified_at)}</div>
                <div className="text-[13px] font-extrabold tracking-code">{e.code ?? '—'}</div>
                <div>
                  {flagged ? (
                    <Chip tone="bad">Admitted · flagged</Chip>
                  ) : e.outcome === 'admitted' ? (
                    <Chip tone="good">Admitted</Chip>
                  ) : (
                    <Chip>{outcomeLabel(e.outcome, e.reject_reason)}</Chip>
                  )}
                </div>
                <div className="truncate text-[12.5px] text-muted">{e.guard_name}</div>
                <div className="truncate text-[12.5px] text-muted">
                  {e.host_name ? `${e.host_name}${e.host_unit ? `, ${e.host_unit}` : ''}` : '—'}
                </div>
                <div
                  className={`text-[12px] font-bold ${e.synced_at ? 'text-muted' : 'text-coral-ink'}`}
                >
                  {e.synced_at ? clock(e.synced_at) : 'Queued'}
                </div>
              </div>
            );
          })
        )}
      </Card>
    </>
  );
}
