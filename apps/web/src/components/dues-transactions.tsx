import { formatMoney } from '@estate/core';
import { Fragment, useMemo, useState, type ReactNode } from 'react';

import { downloadCsv, toCsv } from '../lib/csv';
import { dayTime } from '../lib/format';
import { TRANSACTION_CAP } from '../lib/dues-format';
import type { DuesTransaction } from '../lib/operator';
import { Button, Card, Chip, Empty, FilterChips, Search } from './ui';

/**
 * The dues transaction ledger, shared by the operator's cross-estate view and
 * an estate admin's own. Both read the same server-side query, so both render
 * through this one component -- a field shown on one and not the other would
 * be the start of two answers to "what did this person pay".
 */

const TX_COLS = 'grid grid-cols-[120px_minmax(0,1.3fr)_minmax(0,1.3fr)_120px_110px_100px] gap-4';

const STATUSES = ['All', 'Successful', 'Failed', 'Pending'] as const;
type StatusFilter = (typeof STATUSES)[number];

const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

const money = (minor: number | null, currency: string) =>
  minor === null ? '—' : formatMoney(minor, currency);

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

function exportCsv(rows: DuesTransaction[], filename: string) {
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
  downloadCsv(filename, toCsv([head, ...body]));
}

export function DuesTransactions({
  rows,
  loading,
  showEstate,
  csvName,
}: {
  rows: DuesTransaction[];
  loading: boolean;
  /** Off on an estate's own dashboard, where every row is the same estate. */
  showEstate: boolean;
  csvName: string;
}) {
  const [status, setStatus] = useState<StatusFilter>('All');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((t) => {
      if (status === 'Successful' && t.status !== 'successful') return false;
      if (status === 'Failed' && t.status !== 'failed' && t.status !== 'abandoned') return false;
      if (status === 'Pending' && t.status !== 'initiated') return false;
      if (!q) return true;
      return [t.estate_name, t.house_number, t.payer_name, t.payer_email, t.payer_phone,
        t.billed_name, t.tx_ref, t.provider_tx_id, t.provider_ref]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, status, query]);

  return (
    <>
      <div className="mt-3.5 flex items-center gap-2">
        <Search value={query} onChange={setQuery} placeholder="Search payer, house, email or reference" />
        <FilterChips options={STATUSES} value={status} onChange={setStatus} />
        <Button
          variant="dark"
          className="h-11"
          onClick={() => exportCsv(shown, csvName)}
          disabled={shown.length === 0}
        >
          Export CSV
        </Button>
      </div>

      <Card className="mt-3.5 py-4">
        <div className={`${TX_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>WHEN</span>
          <span>{showEstate ? 'ESTATE · HOUSE' : 'HOUSE'}</span>
          <span>PAID BY</span>
          <span>AMOUNT</span>
          <span>STATUS</span>
          <span></span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : shown.length === 0 ? (
          <Empty>{rows.length === 0 ? 'No dues payments in this period.' : 'Nothing matches.'}</Empty>
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
                  {showEstate ? <span className="font-bold">{t.estate_name} · </span> : null}
                  <span className={showEstate ? 'text-muted' : 'font-bold'}>
                    {t.house_number ? `House ${t.house_number}` : '—'}
                  </span>
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
      {!loading && rows.length >= TRANSACTION_CAP ? (
        <div className="mt-3 text-[12px] font-semibold text-muted">
          Showing the latest {TRANSACTION_CAP.toLocaleString()} transactions. Narrow the period to
          see older ones. The totals above are complete.
        </div>
      ) : null}
    </>
  );
}
