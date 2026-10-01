import { formatMoney } from '@estate/core';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button, Card, Chip, Empty, FilterChips, PageHead, Search, Stat } from '../../components/ui';
import { downloadCsv, toCsv } from '../../lib/csv';
import { dayTime } from '../../lib/format';
import {
  listDuesByEstate, listDuesTransactions,
  type DuesTransaction, type EstateDuesTotals,
} from '../../lib/operator';
import { ago, count } from '../../lib/operator-format';

const ESTATE_COLS = 'grid grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))_110px] gap-4';
const TX_COLS = 'grid grid-cols-[120px_minmax(0,1.3fr)_minmax(0,1.3fr)_120px_110px_100px] gap-4';

const WINDOWS = ['30 days', '90 days', '12 months', 'All time'] as const;
type Window = (typeof WINDOWS)[number];
const WINDOW_DAYS: Record<Window, number | null> = {
  '30 days': 30, '90 days': 90, '12 months': 365, 'All time': null,
};

const STATUSES = ['All', 'Successful', 'Failed', 'Pending'] as const;
type StatusFilter = (typeof STATUSES)[number];

const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

const money = (minor: number | null, currency: string) =>
  minor === null ? '—' : formatMoney(minor, currency);

/** Sum per currency and print each — an NGN and a ZAR figure added together is not a number. */
function byCurrency(rows: EstateDuesTotals[], pick: (r: EstateDuesTotals) => number): string {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.currency, (sums.get(r.currency) ?? 0) + pick(r));
  if (sums.size === 0) return formatMoney(0, 'NGN');
  return [...sums].map(([c, n]) => formatMoney(n, c)).join(' · ');
}

const PAID_VIA: Record<string, string> = {
  resident: 'Resident, in the app',
  admin: 'Estate admin',
  pay_link: 'Payment link (no account)',
};

function statusChip(s: DuesTransaction['status']) {
  if (s === 'successful') return <Chip tone="good">Paid</Chip>;
  if (s === 'failed') return <Chip tone="bad">Failed</Chip>;
  if (s === 'abandoned') return <Chip>Abandoned</Chip>;
  return <Chip>Pending</Chip>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-extrabold tracking-label text-muted">{label}</div>
      <div className="mt-1 break-words text-[12.5px] font-semibold">{children ?? '—'}</div>
    </div>
  );
}

/** Everything known about one attempt. Rendered under its row, not in a modal, so rows can be compared. */
function Detail({ t }: { t: DuesTransaction }) {
  const pct = t.platform_fee_percent;
  return (
    <div className="grid grid-cols-4 gap-x-6 gap-y-4 border-t border-hair bg-field/50 px-4 py-4">
      <Field label="ESTATE">{t.estate_name}</Field>
      <Field label="HOUSE">{t.house_number ? `House ${t.house_number}` : null}</Field>
      <Field label="DUES FOR">{monthLabel(t.charge_period)}</Field>
      <Field label="CHARGE DUE">{new Date(`${t.charge_due_on}T00:00:00`).toLocaleDateString()}</Field>

      <Field label="BILLED TO">
        {t.billed_to === 'house' ? 'The house (landlord)' : 'The resident'}
        {t.billed_name ? ` · ${t.billed_name}` : ''}
      </Field>
      <Field label="PAID BY">{t.payer_name}</Field>
      <Field label="PAYER EMAIL">{t.payer_email}</Field>
      <Field label="PAYER PHONE">{t.payer_phone}</Field>

      <Field label="PAID VIA">{PAID_VIA[t.paid_via] ?? t.paid_via}</Field>
      <Field label="METHOD">
        {t.payment_type ? t.payment_type.replace(/_/g, ' ') : null}
        {t.card_brand ? ` · ${t.card_brand}` : ''}
        {t.card_last4 ? ` ···· ${t.card_last4}` : ''}
      </Field>
      <Field label="CARD ISSUER">{t.card_issuer}</Field>
      <Field label="PROVIDER RESPONSE">{t.processor_response}</Field>

      <Field label="DUES AMOUNT">{money(t.amount_minor, t.currency)}</Field>
      <Field label="CUSTOMER CHARGED">{money(t.charged_minor, t.currency)}</Field>
      <Field label="PROVIDER FEE">{money(t.provider_fee_minor, t.currency)}</Field>
      <Field label="SETTLED (NET)">{money(t.settled_minor, t.currency)}</Field>

      <Field label="PLATFORM COMMISSION">
        {t.platform_fee_minor !== null
          ? `${money(t.platform_fee_minor, t.currency)} (${(Number(pct) * 100).toFixed(2).replace(/\.?0+$/, '')}%)`
          : pct === null
            ? 'Not recorded (paid before rates were stored per payment)'
            : 'None — no money moved'}
      </Field>
      <Field label="STARTED">{new Date(t.created_at).toLocaleString()}</Field>
      <Field label="SETTLED">{t.settled_at ? new Date(t.settled_at).toLocaleString() : null}</Field>
      <Field label="CHARGE STATUS">{t.charge_status}</Field>

      <Field label="OUR REFERENCE">
        <span className="font-mono text-[11.5px]">{t.tx_ref}</span>
      </Field>
      <Field label="PROVIDER">{t.provider}</Field>
      <Field label="PROVIDER TX ID">
        {t.provider_tx_id ? <span className="font-mono text-[11.5px]">{t.provider_tx_id}</span> : null}
      </Field>
      <Field label="PROVIDER REF">
        {t.provider_ref ? <span className="font-mono text-[11.5px]">{t.provider_ref}</span> : null}
      </Field>
    </div>
  );
}

function exportCsv(rows: DuesTransaction[]) {
  const head = [
    'Started', 'Settled', 'Status', 'Estate', 'House', 'Dues period', 'Billed to', 'Billed name',
    'Paid by', 'Payer email', 'Payer phone', 'Paid via', 'Currency', 'Dues amount',
    'Customer charged', 'Provider fee', 'Settled (net)', 'Platform fee %', 'Platform commission',
    'Method', 'Card', 'Card issuer', 'Provider response', 'Our reference', 'Provider',
    'Provider tx id', 'Provider ref',
  ];
  // Major units in the export: a spreadsheet user sums 25000, not 2500000.
  const major = (n: number | null) => (n === null ? '' : (n / 100).toFixed(2));
  const body = rows.map((t) => [
    t.created_at, t.settled_at, t.status, t.estate_name, t.house_number, t.charge_period,
    t.billed_to, t.billed_name, t.payer_name, t.payer_email, t.payer_phone, t.paid_via,
    t.currency, major(t.amount_minor), major(t.charged_minor), major(t.provider_fee_minor),
    major(t.settled_minor), t.platform_fee_percent === null ? '' : String(t.platform_fee_percent),
    major(t.platform_fee_minor), t.payment_type,
    t.card_last4 ? `${t.card_brand ?? ''} ${t.card_last4}`.trim() : '', t.card_issuer,
    t.processor_response, t.tx_ref, t.provider, t.provider_tx_id, t.provider_ref,
  ]);
  downloadCsv(`dues-transactions-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([head, ...body]));
}

export function Payments() {
  const [window_, setWindow] = useState<Window>('30 days');
  const [estateId, setEstateId] = useState<string>('');
  const [status, setStatus] = useState<StatusFilter>('All');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const [totals, setTotals] = useState<EstateDuesTotals[]>([]);
  const [txs, setTxs] = useState<DuesTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const days = WINDOW_DAYS[window_];
    const since = days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txs.filter((t) => {
      if (status === 'Successful' && t.status !== 'successful') return false;
      if (status === 'Failed' && t.status !== 'failed' && t.status !== 'abandoned') return false;
      if (status === 'Pending' && t.status !== 'initiated') return false;
      if (!q) return true;
      return [t.estate_name, t.house_number, t.payer_name, t.payer_email, t.payer_phone,
        t.billed_name, t.tx_ref, t.provider_tx_id, t.provider_ref]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [txs, status, query]);

  return (
    <>
      <PageHead
        title="Dues payments"
        blurb="Every dues payment taken on the platform — by estate, by house and by resident — including failed attempts and the platform's commission on each."
        right={
          <Button variant="dark" onClick={() => exportCsv(shown)} disabled={shown.length === 0}>
            Export CSV
          </Button>
        }
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
      <div className="mt-3.5 flex items-center gap-2">
        <Search value={query} onChange={setQuery} placeholder="Search payer, house, email or reference" />
        <FilterChips options={STATUSES} value={status} onChange={setStatus} />
      </div>

      <Card className="mt-3.5 py-4">
        <div className={`${TX_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>WHEN</span>
          <span>ESTATE · HOUSE</span>
          <span>PAID BY</span>
          <span>AMOUNT</span>
          <span>STATUS</span>
          <span></span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{txs.length === 0 ? 'No dues payments in this period.' : 'Nothing matches.'}</Empty>
        ) : (
          shown.map((t) => (
            <Fragment key={t.payment_id}>
              <button
                type="button"
                onClick={() => setOpen(open === t.payment_id ? null : t.payment_id)}
                aria-expanded={open === t.payment_id}
                className={`${TX_COLS} w-full items-center border-t border-hair px-4 py-3 text-left transition hover:bg-field/60`}
              >
                <span className="text-[12.5px] text-muted">{dayTime(t.settled_at ?? t.created_at)}</span>
                <span className="min-w-0 truncate text-[13px]">
                  <span className="font-bold">{t.estate_name}</span>
                  {t.house_number ? <span className="text-muted"> · House {t.house_number}</span> : null}
                </span>
                <span className="min-w-0 truncate text-[13px]">
                  {t.payer_name ?? t.payer_email ?? '—'}
                  <span className="text-muted"> · {monthLabel(t.charge_period)}</span>
                </span>
                <span className="text-[12.5px] font-bold">{formatMoney(t.amount_minor, t.currency)}</span>
                <span>{statusChip(t.status)}</span>
                <span className="text-right text-[12px] font-bold text-muted">
                  {open === t.payment_id ? 'Hide' : 'Details'}
                </span>
              </button>
              {open === t.payment_id ? <Detail t={t} /> : null}
            </Fragment>
          ))
        )}
      </Card>
      {!loading && txs.length >= 2000 ? (
        <div className="mt-3 text-[12px] font-semibold text-muted">
          Showing the latest 2,000 transactions. Narrow the period or pick an estate to see older ones.
          The totals above are complete.
        </div>
      ) : null}
    </>
  );
}
