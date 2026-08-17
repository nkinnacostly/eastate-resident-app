import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Avatar, Card, Chip, Empty, PageHead, Stat } from '../../components/ui';
import {
  getPortfolio, listDailyVolume, listOperatorEstates,
  type OperatorEstate, type Portfolio as PortfolioStats, type VolumeDay,
} from '../../lib/operator';
import { ago, count, dayLabel, isWeekend } from '../../lib/operator-format';

const COLS = 'grid grid-cols-[minmax(0,1.6fr)_90px_110px_minmax(0,1fr)] gap-4';

/**
 * Verifications per day.
 *
 * Hand-drawn divs rather than a charting library: it is one series of bars, and
 * a dependency that ships its own SVG renderer to draw thirty rectangles is not
 * worth the bundle or the version churn.
 */
function VolumeChart({ days }: { days: VolumeDay[] }) {
  const peak = Math.max(1, ...days.map((d) => d.verifications));
  const total = days.reduce((n, d) => n + d.verifications, 0);
  const busiest = days.reduce<VolumeDay | null>(
    (best, d) => (best === null || d.verifications > best.verifications ? d : best),
    null,
  );

  // Only ever four labels — one per week — because thirty dates at 9px collide
  // into a grey smear.
  const labelEvery = Math.max(1, Math.floor(days.length / 4));

  return (
    <Card className="mt-3.5 p-[18px]">
      <div className="flex gap-3">
        {/* De-duplicated: with a peak of 3, quartered ticks round to 3,2,2,1,0
            and the repeat reads as a rendering fault. */}
        <div className="flex flex-none flex-col justify-between pb-5 text-[9.5px] font-bold text-muted">
          {[...new Set([1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(peak * f)))].map((t) => (
            <span key={t}>{t.toLocaleString()}</span>
          ))}
        </div>
        <div className="flex h-[172px] flex-1 items-end gap-[5px]">
          {days.map((d, i) => {
            const last = i === days.length - 1;
            return (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-2">
                <div
                  title={`${dayLabel(d.day)} — ${count(d.verifications)} verifications`}
                  style={{ height: `${Math.max(2, (d.verifications / peak) * 140)}px` }}
                  className={`w-full rounded-[6px] ${
                    last ? 'bg-ink' : isWeekend(d.day) ? 'bg-lime' : 'bg-[#e2e8ee]'
                  }`}
                />
                <span className="h-3 whitespace-nowrap text-[9px] font-bold text-muted">
                  {last || i % labelEvery === 0 ? dayLabel(d.day) : ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3.5 flex gap-[18px] border-t border-hair pt-3.5 text-[11.5px] font-semibold text-muted">
        <span className="flex items-center gap-[7px]">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-lime" />
          Weekend
        </span>
        <span className="flex items-center gap-[7px]">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-ink" />
          Today
        </span>
        <span className="ml-auto">
          {count(total)} verifications over {days.length} days
          {busiest && busiest.verifications > 0
            ? ` · peak ${count(busiest.verifications)} on ${dayLabel(busiest.day)}`
            : ''}
        </span>
      </div>
    </Card>
  );
}

/**
 * The attention list, derived rather than curated.
 *
 * Each item is a fact the data can prove. The design shows hand-written
 * operational notes here; inventing those would be worse than showing fewer,
 * true ones.
 */
function attentionItems(estates: OperatorEstate[]) {
  const items: { title: string; body: string; tone: 'bad' | 'plain' }[] = [];

  const noAdmin = estates.filter((e) => e.admin_count === 0);
  if (noAdmin.length) {
    items.push({
      title: noAdmin.length === 1 ? 'Onboarding stalled' : `${noAdmin.length} onboardings stalled`,
      body: `${noAdmin.map((e) => e.name).join(', ')} — no admin account, so nothing can reach the gate yet.`,
      tone: 'bad',
    });
  }

  const neverUsed = estates.filter((e) => e.admin_count > 0 && e.houses === 0);
  if (neverUsed.length) {
    items.push({
      title: 'No houses yet',
      body: `${neverUsed.map((e) => e.name).join(', ')} — the admin has signed up but added no houses, so residents cannot join.`,
      tone: 'plain',
    });
  }

  const flagged = estates.filter((e) => e.flagged_30d > 0);
  if (flagged.length) {
    items.push({
      title: `${flagged.reduce((n, e) => n + e.flagged_30d, 0)} flagged entries`,
      body: `${flagged.map((e) => `${e.name} (${e.flagged_30d})`).join(', ')} — a guard admitted a code the phone could not resolve.`,
      tone: 'bad',
    });
  }

  const quiet = estates.filter((e) => e.residents > 0 && e.verifications_30d === 0);
  if (quiet.length) {
    items.push({
      title: 'Quiet gates',
      body: `${quiet.map((e) => e.name).join(', ')} — residents on file but no verification in 30 days.`,
      tone: 'plain',
    });
  }

  return items;
}

export function Portfolio() {
  const [stats, setStats] = useState<PortfolioStats | null>(null);
  const [estates, setEstates] = useState<OperatorEstate[]>([]);
  const [days, setDays] = useState<VolumeDay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [s, e, v] = await Promise.all([
          getPortfolio(),
          listOperatorEstates(),
          listDailyVolume(30),
        ]);
        if (!live) return;
        setStats(s);
        setEstates(e);
        setDays(v);
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
  }, []);

  const busiest = useMemo(
    () => [...estates].sort((a, b) => b.verifications_30d - a.verifications_30d).slice(0, 5),
    [estates],
  );
  const items = useMemo(() => attentionItems(estates), [estates]);

  return (
    <>
      <PageHead
        title="Portfolio"
        blurb="Every estate on the platform, how much gate traffic each one carries, and where onboarding has stalled. Estate admins never see this view."
        right={
          <Link
            to="/estates"
            className="inline-flex h-[42px] items-center rounded-chip bg-lime px-[22px] text-[13.5px] font-extrabold text-ink transition hover:brightness-95"
          >
            Onboard an estate
          </Link>
        }
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="ESTATES LIVE" value={loading ? '—' : count(stats?.estates_live)} />
        <Stat label="VERIFIED · 30D" value={loading ? '—' : count(stats?.verifications_30d)} />
        <Stat label="RESIDENTS" value={loading ? '—' : count(stats?.residents_total)} />
        <Stat
          label="FLAGGED · 30D"
          value={loading ? '—' : count(stats?.flagged_30d)}
          tone={stats?.flagged_30d ? 'bad' : undefined}
        />
      </div>

      <div className="mt-[26px] grid grid-cols-[1.25fr_1fr] gap-[26px]">
        <section className="min-w-0">
          <h2 className="text-[16.5px] font-extrabold tracking-tight">
            Verifications across the platform
          </h2>
          {loading ? (
            <Card className="mt-3.5">
              <Empty>Loading…</Empty>
            </Card>
          ) : (
            <VolumeChart days={days} />
          )}

          <h2 className="mt-[26px] text-[16.5px] font-extrabold tracking-tight">Busiest estates</h2>
          <Card className="mt-3.5 py-4">
            <div className={`${COLS} px-[18px] pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
              <span>ESTATE</span>
              <span>HOUSES</span>
              <span>VERIFIED · 30D</span>
              <span>LAST ACTIVITY</span>
            </div>
            {loading ? (
              <Empty>Loading…</Empty>
            ) : busiest.length === 0 ? (
              <Empty>No estates yet. Onboard one and it appears here.</Empty>
            ) : (
              busiest.map((e) => (
                <div key={e.id} className={`${COLS} items-center border-t border-hair px-[18px] py-3.5`}>
                  <div className="flex min-w-0 items-center gap-[11px]">
                    <Avatar name={e.name} />
                    <span className="truncate text-[13.5px] font-bold">{e.name}</span>
                  </div>
                  <span className="text-[12.5px] text-muted">{count(e.houses)}</span>
                  <span className="text-[13px] font-extrabold">{count(e.verifications_30d)}</span>
                  <span className="text-[12.5px] text-muted">{ago(e.last_activity)}</span>
                </div>
              ))
            )}
          </Card>
        </section>

        <section className="min-w-0">
          <h2 className="text-[16.5px] font-extrabold tracking-tight">Needs your attention</h2>

          {loading ? (
            <Card className="mt-3.5">
              <Empty>Loading…</Empty>
            </Card>
          ) : items.length === 0 ? (
            <Card className="mt-3.5 bg-ink p-5 text-canvas">
              <div className="text-[13px] font-extrabold">Nothing to chase</div>
              <div className="mt-1.5 text-[12px] leading-[1.55] text-muted-2">
                Every estate has an admin, houses on file and a gate that has seen traffic. This
                list is derived from the data, so it fills itself back in when something slips.
              </div>
            </Card>
          ) : (
            items.map((it) => (
              <Card key={it.title} className="mt-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-extrabold">{it.title}</div>
                    <div className="mt-1.5 text-[11.5px] leading-[1.5] text-muted">{it.body}</div>
                  </div>
                  <Chip tone={it.tone === 'bad' ? 'bad' : 'plain'}>
                    {it.tone === 'bad' ? 'ACTION' : 'WATCH'}
                  </Chip>
                </div>
              </Card>
            ))
          )}

          <Card className="mt-3.5 bg-ink p-5 text-canvas">
            <div className="text-[11px] font-extrabold tracking-[0.1em] text-lime">
              WHAT YOU CANNOT SEE
            </div>
            <div className="mt-2.5 text-[12px] leading-[1.55] text-muted-2">
              Codes never appear on this dashboard. You can see that a verification happened, at
              which estate and when — never the characters a resident sent to their visitor. That
              boundary is what lets an estate hand you its audit trail.
            </div>
          </Card>
        </section>
      </div>
    </>
  );
}
