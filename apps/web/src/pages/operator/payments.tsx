import { formatMoney } from '@estate/core';
import { useEffect, useMemo, useState } from 'react';

import { DuesTransactions } from '../../components/dues-transactions';
import { Card, Empty, FilterChips, PageHead, Stat } from '../../components/ui';
import { WINDOWS, byCurrency, sinceFor, type Window } from '../../lib/dues-format';
import {
  listDuesByEstate, listDuesTransactions,
  type DuesTransaction, type EstateDuesTotals,
} from '../../lib/operator';
import { ago, count } from '../../lib/operator-format';

const ESTATE_COLS = 'grid grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))_110px] gap-4';

export function Payments() {
  const [window_, setWindow] = useState<Window>('30 days');
  const [estateId, setEstateId] = useState<string>('');

  const [totals, setTotals] = useState<EstateDuesTotals[]>([]);
  const [txs, setTxs] = useState<DuesTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const since = sinceFor(window_);
    setLoading(true);
    void (async () => {
      try {
        const [t, x] = await Promise.all([
          listDuesByEstate(since),
          listDuesTransactions({ estateId: estateId || null, since }),
        ]);
        if (!live) return;
        setTotals(t);
        setTxs(x);
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
  }, [window_, estateId]);

  // Estate names for the picker come from the totals, which list every estate
  // that has billed anything -- an estate that never billed has nothing to show.
  const estateOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of totals) m.set(t.estate_id, t.estate_name);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [totals]);

  const scoped = estateId ? totals.filter((t) => t.estate_id === estateId) : totals;

  return (
    <>
      <PageHead
        title="Dues payments"
        blurb="Every dues payment taken on the platform — by estate, by house and by resident — including failed attempts and the platform's commission on each."
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <FilterChips options={WINDOWS} value={window_} onChange={setWindow} />
        <select
          value={estateId}
          onChange={(e) => setEstateId(e.target.value)}
          aria-label="Estate"
          className="ml-auto h-11 rounded-[14px] bg-field px-3 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-lime"
        >
          <option value="">All estates</option>
          {estateOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <Stat label="COLLECTED" value={loading ? '—' : byCurrency(scoped, (r) => r.collected_minor)} />
        <Stat label="PLATFORM COMMISSION" value={loading ? '—' : byCurrency(scoped, (r) => r.platform_fee_minor)} />
        <Stat label="SUCCESSFUL PAYMENTS" value={loading ? '—' : count(scoped.reduce((n, r) => n + r.payments, 0))} />
        <Stat
          label="FAILED ATTEMPTS"
          value={loading ? '—' : count(scoped.reduce((n, r) => n + r.failed, 0))}
          tone={scoped.some((r) => r.failed > 0) ? 'bad' : undefined}
        />
      </div>

      {!estateId ? (
        <>
          <h2 className="mt-[26px] text-[16.5px] font-extrabold tracking-tight">By estate</h2>
          <Card className="mt-3.5 py-4">
            <div className={`${ESTATE_COLS} px-[18px] pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
              <span>ESTATE</span>
              <span>COLLECTED</span>
              <span>COMMISSION</span>
              <span>PAYERS</span>
              <span>OUTSTANDING NOW</span>
              <span>LAST PAYMENT</span>
            </div>
            {loading ? (
              <Empty>Loading…</Empty>
            ) : totals.length === 0 ? (
              <Empty>No estate has billed dues yet.</Empty>
            ) : (
              totals.map((t) => (
                <button
                  key={`${t.estate_id}-${t.currency}`}
                  type="button"
                  onClick={() => setEstateId(t.estate_id)}
                  className={`${ESTATE_COLS} w-full items-center border-t border-hair px-[18px] py-3.5 text-left transition hover:bg-field/60`}
                >
                  <span className="truncate text-[13.5px] font-bold">{t.estate_name}</span>
                  <span className="text-[13px] font-extrabold">{formatMoney(t.collected_minor, t.currency)}</span>
                  <span className="text-[12.5px]">{formatMoney(t.platform_fee_minor, t.currency)}</span>
                  <span className="text-[12.5px] text-muted">{count(t.payers)}</span>
                  <span className={`text-[12.5px] ${t.outstanding_minor > 0 ? 'font-bold text-coral-ink' : 'text-muted'}`}>
                    {formatMoney(t.outstanding_minor, t.currency)}
                    {t.open_charges ? ` · ${count(t.open_charges)}` : ''}
                  </span>
                  <span className="text-[12.5px] text-muted">{ago(t.last_payment_at)}</span>
                </button>
              ))
            )}
          </Card>
        </>
      ) : null}

      <div className="mt-[26px] flex items-center gap-3">
        <h2 className="text-[16.5px] font-extrabold tracking-tight">Transactions</h2>
        {estateId ? (
          <button
            type="button"
            onClick={() => setEstateId('')}
            className="text-[12px] font-bold text-muted underline hover:text-ink"
          >
            All estates
          </button>
        ) : null}
      </div>
      <div className="mt-3.5">
        <DuesTransactions
          rows={txs}
          loading={loading}
          showEstate={!estateId}
          csvName={`dues-transactions-${new Date().toISOString().slice(0, 10)}.csv`}
        />
      </div>
    </>
  );
}
