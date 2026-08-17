import { useEffect, useMemo, useState } from 'react';

import { Card, Empty, PageHead, Stat } from '../../components/ui';
import { getPortfolio, listHealth, type HealthRow, type Portfolio } from '../../lib/operator';
import { count, duration } from '../../lib/operator-format';

const COLS = 'grid grid-cols-[minmax(0,1.4fr)_110px_100px_100px_110px_110px] gap-4';

export function Health() {
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [stats, setStats] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [h, s] = await Promise.all([listHealth(), getPortfolio()]);
        if (!live) return;
        setRows(h);
        setStats(s);
        setError(null);
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const offlineShare = useMemo(() => {
    if (!stats || stats.verifications_30d === 0) return '0%';
    return `${((stats.offline_30d / stats.verifications_30d) * 100).toFixed(1)}%`;
  }, [stats]);

  // Share of the platform's offline verifications, per estate. A single estate
  // carrying most of them points at one bad signal spot, not a platform fault.
  const offlineTotal = rows.reduce((n, r) => n + r.offline_30d, 0);
  const worstLag = rows.reduce<number>((m, r) => Math.max(m, r.worst_lag_seconds ?? 0), 0);

  return (
    <>
      <PageHead
        title="Platform health"
        blurb="How much of the platform's traffic is being decided on a guard's phone rather than at the server, and how long those decisions took to arrive."
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="VERIFICATIONS · 30D" value={loading ? '—' : count(stats?.verifications_30d)} />
        <Stat label="DECIDED OFFLINE" value={loading ? '—' : offlineShare} />
        <Stat
          label="LONGEST SYNC LAG"
          value={loading ? '—' : offlineTotal === 0 ? 'None yet' : duration(worstLag)}
        />
        <Stat
          label="FLAGGED · 30D"
          value={loading ? '—' : count(stats?.flagged_30d)}
          tone={stats?.flagged_30d ? 'bad' : undefined}
        />
      </div>

      <Card className="mt-[26px] bg-ink p-5 text-canvas">
        <div className="text-[11px] font-extrabold tracking-[0.1em] text-lime">
          WHY THERE IS NO &ldquo;UNSYNCED&rdquo; COUNT
        </div>
        <div className="mt-2.5 text-[12px] leading-[1.55] text-muted-2">
          The server cannot see what is still sitting on a guard&apos;s phone — that is the whole
          point of the offline design. What it can see is how long each event that <em>did</em>{' '}
          arrive spent in the queue, which is the same signal measured from the side that has the
          data. A rising sync lag is a gate losing its connection.
        </div>
      </Card>

      <h2 className="mt-[26px] text-[16.5px] font-extrabold tracking-tight">
        Where offline is doing the work
      </h2>
      <Card className="mt-3.5 py-4">
        <div className={`${COLS} px-[18px] pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>ESTATE</span>
          <span>VERIFIED · 30D</span>
          <span>OFFLINE</span>
          <span>SHARE</span>
          <span>MEDIAN LAG</span>
          <span>WORST LAG</span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>No estates yet.</Empty>
        ) : (
          rows.map((r) => (
            <div key={r.estate_id} className={`${COLS} items-center border-t border-hair px-[18px] py-3.5`}>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold">{r.estate_name}</div>
                {/* The bar carries the comparison; the number carries the value.
                    Share of THIS estate's own traffic, not of the platform. */}
                <div className="mt-2 h-1.5 w-full rounded-[3px] bg-hair">
                  <div
                    style={{ width: `${Math.min(100, r.offline_share)}%` }}
                    className={`h-full rounded-[3px] ${r.offline_share > 25 ? 'bg-coral' : 'bg-lime'}`}
                  />
                </div>
              </div>
              <span className="text-[13px] font-extrabold">{count(r.verifications_30d)}</span>
              <span className="text-[12.5px] text-muted">{count(r.offline_30d)}</span>
              <span className="text-[12.5px] font-bold">{r.offline_share}%</span>
              <span className="text-[12.5px] text-muted">{duration(r.median_lag_seconds)}</span>
              <span className="text-[12.5px] text-muted">{duration(r.worst_lag_seconds)}</span>
            </div>
          ))
        )}
      </Card>

      {!loading && offlineTotal === 0 ? (
        <p className="mt-3 text-[11.5px] leading-[1.5] text-muted">
          Nothing has been verified offline in the last 30 days, so the lag columns are empty. They
          fill in the first time a guard verifies without a connection and the events replay.
        </p>
      ) : null}
    </>
  );
}
