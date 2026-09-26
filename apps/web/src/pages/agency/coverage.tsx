import { useCallback, useEffect, useState } from 'react';

import { Card, Chip, Empty, FilterChips, PageHead, Stat } from '../../components/ui';
import { listCoverage, type Coverage } from '../../lib/agency';
import { useAuth } from '../../lib/auth-context';

const COLS = 'grid grid-cols-[1.4fr_90px_90px_90px_90px_90px_110px] gap-4';
const RANGES = ['7 days', '30 days', '90 days'] as const;
const DAYS: Record<(typeof RANGES)[number], number> = { '7 days': 7, '30 days': 30, '90 days': 90 };

/**
 * What the agency sees of the estates it guards: counts, and nothing else.
 *
 * There is no way to drill from here into an individual entry, and that is not
 * an unfinished feature. A guarding company aggregating identifiable visitor
 * data across its whole client base for its own reporting stops being an
 * operator acting on each estate's mandate and becomes legally responsible for
 * that processing in its own right -- and POPIA has no joint-controller regime
 * to share the load. Counts fall outside the Act entirely under s6(1)(b).
 *
 * PSIRA's Code adds an independent reason: clause 9(13)(b) forbids a provider
 * using a client's confidential information to compete with that client.
 *
 * It is also, straightforwardly, what an agency needs. It is watching its own
 * service -- is the gate manned, are officers arriving, how many people are
 * being turned away -- and none of that requires knowing who visited whom.
 */
export function AgencyCoverage() {
  const { agencies } = useAuth();
  const agency = agencies[0] ?? null;
  const [rows, setRows] = useState<Coverage[]>([]);
  const [range, setRange] = useState<(typeof RANGES)[number]>('30 days');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agency) return;
    setLoading(true);
    try {
      setRows(await listCoverage(agency.agency_id, DAYS[range]));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [agency, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = rows.filter((r) => r.contract_live);
  const hours = rows.reduce((n, r) => n + Number(r.hours ?? 0), 0);
  const flagged = rows.reduce((n, r) => n + Number(r.entries_flagged ?? 0), 0);

  return (
    <>
      <PageHead
        title="Coverage"
        blurb="Your estates, the hours your officers worked at each, and how entries went. Counts only — an estate's visitor and resident records stay with the estate."
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="LIVE CONTRACTS" value={live.length} />
        <Stat label="ESTATES SEEN" value={rows.length} />
        <Stat label="HOURS WORKED" value={hours.toFixed(1)} />
        <Stat label="FLAGGED ENTRIES" value={flagged} tone={flagged ? 'bad' : undefined} />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <FilterChips options={RANGES} value={range} onChange={setRange} />
      </div>

      <Card className="mt-3.5 py-4">
        <div className={`${COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>ESTATE</span>
          <span>CONTRACT</span>
          <span>OFFICERS</span>
          <span>SHIFTS</span>
          <span>HOURS</span>
          <span>ADMITTED</span>
          <span>REFUSED / FLAGGED</span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            No estates yet. An estate adds your agency from its own dashboard — you cannot
            contract yourself in, by design.
          </Empty>
        ) : (
          rows.map((r) => (
            <div key={r.estate_id} className={`${COLS} items-center border-t border-hair px-4 py-3`}>
              <div className="truncate text-[13px] font-bold">{r.estate_name}</div>
              <div>
                {r.contract_live ? <Chip tone="good">Live</Chip> : <Chip>Ended</Chip>}
              </div>
              <div className="text-[12.5px] text-muted">{r.officers}</div>
              <div className="text-[12.5px] text-muted">{r.shifts}</div>
              <div className="text-[12.5px] text-muted">{Number(r.hours ?? 0).toFixed(1)}</div>
              <div className="text-[12.5px] text-muted">{r.entries_admitted}</div>
              <div className="text-[12.5px] text-muted">
                {r.entries_refused}
                {r.entries_flagged > 0 ? (
                  <span className="ml-1.5 font-bold text-coral-ink">· {r.entries_flagged}</span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Card>

      <Card className="mt-4 p-4">
        <p className="text-[12.5px] leading-[19px] text-muted">
          A flagged entry is one an officer admitted without the phone matching a code, usually
          because the gate had no signal. The estate reviews these with the officer&apos;s name;
          you see the count so you know to ask.
        </p>
      </Card>
    </>
  );
}
