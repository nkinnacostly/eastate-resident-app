import { formatMoney } from '@estate/core';
import { useEffect, useState } from 'react';

import { DuesTransactions } from '../components/dues-transactions';
import { FilterChips, HeadActions, PageHead, Stat } from '../components/ui';
import { WINDOWS, byCurrency, sinceFor, type Window } from '../lib/dues-format';
import { getEstateDuesTotals, listEstateDuesPayments } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import type { DuesTransaction, EstateDuesTotals } from '../lib/operator';

/**
 * Every dues payment at this estate: residents paying in the app, landlords
 * paying from the emailed link, and the attempts that failed.
 *
 * Separate from the Dues page, which is about what is OWED (charges); this is
 * about what was PAID and how. A charge can carry several attempts, and the
 * failed ones are exactly what an admin needs when a resident says "I paid".
 */
export function DuesPayments() {
  const { activeEstateId, activeEstate } = useAuth();
  const [window_, setWindow] = useState<Window>('90 days');
  const [totals, setTotals] = useState<EstateDuesTotals[]>([]);
  const [txs, setTxs] = useState<DuesTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeEstateId) return;
    let live = true;
    const since = sinceFor(window_);
    setLoading(true);
    void (async () => {
      try {
        const [t, x] = await Promise.all([
          getEstateDuesTotals(activeEstateId, since),
          listEstateDuesPayments(activeEstateId, since),
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
  }, [activeEstateId, window_]);

  const estateName = activeEstate?.estate_name ?? 'estate';
  const slug = estateName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'estate';

  return (
    <>
      <PageHead
        title="Payments"
        blurb="Every dues payment at this estate — residents and landlords — with who paid, how, and what reached the estate's account. Failed attempts are listed too."
        right={<HeadActions estate={activeEstate?.estate_name ?? '—'} />}
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <FilterChips options={WINDOWS} value={window_} onChange={setWindow} />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        <Stat label="COLLECTED" value={loading ? '—' : byCurrency(totals, (r) => r.collected_minor)} />
        {/* Distinct charges' subjects: a house where house-billed, a resident where not. */}
        <Stat label="HOUSES / RESIDENTS PAID" value={loading ? '—' : totals.reduce((n, r) => n + r.payers, 0)} />
        <Stat
          label="FAILED ATTEMPTS"
          value={loading ? '—' : totals.reduce((n, r) => n + r.failed, 0)}
          tone={totals.some((r) => r.failed > 0) ? 'bad' : undefined}
        />
        <Stat
          label="OUTSTANDING NOW"
          value={loading ? '—' : totals.length ? byCurrency(totals, (r) => r.outstanding_minor) : formatMoney(0, 'NGN')}
          tone={totals.some((r) => r.outstanding_minor > 0) ? 'bad' : undefined}
        />
      </div>

      <div className="mt-[26px]">
        <DuesTransactions
          rows={txs}
          loading={loading}
          showEstate={false}
          csvName={`${slug}-dues-payments-${new Date().toISOString().slice(0, 10)}.csv`}
        />
      </div>
    </>
  );
}
