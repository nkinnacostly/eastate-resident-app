import { formatMoney } from '@estate/core';
import { createColumnHelper } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  BackLink, ChargeTable, DetailHead, DetailState, Field, FieldCard, SectionTitle,
} from '../components/detail';
import { DataTable } from '../components/data-table';
import { DuesTransactions } from '../components/dues-transactions';
import { Avatar, Chip, Code, HeadActions, Stat } from '../components/ui';
import { listEstateDuesPayments } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import type { DataTableFeatures } from '../lib/data-table';
import { getHouseDetail, type HouseDetail, type HouseResident } from '../lib/detail';
import { dateLabel } from '../lib/format';
import type { DuesTransaction } from '../lib/operator';
import { ago } from '../lib/operator-format';

const col = createColumnHelper<DataTableFeatures, HouseResident>();

/**
 * The residents table. Module-level so the reference is stable: TanStack
 * rebuilds its row models whenever `columns` changes identity.
 *
 * Only name, phone and email take part in search. Counts, dates and statuses
 * would match nonsense -- searching "2" would find everyone with two codes and
 * every date in 2026.
 */
const residentColumns = col.columns([
  col.accessor('full_name', {
    header: 'Name',
    cell: (info) => (
      <Link
        to={`../../residents/${info.row.original.membership_id}`}
        relative="path"
        className="flex items-center gap-2.5 font-bold text-ink hover:underline"
      >
        <Avatar name={info.getValue()} />
        <span className="truncate">{info.getValue()}</span>
      </Link>
    ),
  }),
  col.accessor('phone', { header: 'Phone', cell: (info) => info.getValue() ?? '—' }),
  col.accessor('email', { header: 'Email', cell: (info) => info.getValue() ?? '—' }),
  col.accessor('is_active', {
    header: 'Status',
    enableGlobalFilter: false,
    cell: (info) => (info.getValue() ? <Chip tone="good">Active</Chip> : <Chip>Suspended</Chip>),
  }),
  col.accessor('in_arrears', {
    header: 'Dues',
    enableGlobalFilter: false,
    cell: (info) => (info.getValue() ? <Chip tone="bad">Overdue</Chip> : <Chip>Up to date</Chip>),
  }),
  col.accessor('live_codes', { header: 'Live codes', enableGlobalFilter: false }),
  col.accessor('codes_30d', { header: 'Codes · 30d', enableGlobalFilter: false }),
  col.accessor('joined_at', {
    header: 'Joined',
    enableGlobalFilter: false,
    cell: (info) => dateLabel(info.getValue()),
  }),
  // Null for someone who never signed in; sorted as the empty string so they
  // gather at one end instead of failing the comparison.
  col.accessor((r) => r.last_sign_in_at ?? '', {
    id: 'last_sign_in_at',
    header: 'Last sign-in',
    enableGlobalFilter: false,
    cell: (info) => (info.row.original.last_sign_in_at ? ago(info.row.original.last_sign_in_at) : 'Never'),
  }),
]);

const PAYER: Record<string, string> = {
  landlord: 'The landlord — one bill for the house',
  residents: 'Each resident — a bill per person',
};

/**
 * One house: who lives there, who owns it, how it is billed, and every charge
 * and payment against it -- the house's own and its residents'.
 */
export function HouseProfile() {
  const { houseId = '' } = useParams();
  const { activeEstateId, activeEstate } = useAuth();
  const [d, setD] = useState<HouseDetail | null>(null);
  const [payments, setPayments] = useState<DuesTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeEstateId || !houseId) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const [detail, pays] = await Promise.all([
          getHouseDetail(activeEstateId, houseId),
          listEstateDuesPayments(activeEstateId, null),
        ]);
        if (!live) return;
        setD(detail);
        const charges = new Set((detail?.charges ?? []).map((c) => c.charge_id));
        setPayments(pays.filter((p) => charges.has(p.charge_id)));
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
  }, [activeEstateId, houseId]);

  const back = <BackLink label="All houses" />;
  if (loading) return <DetailState back={back}>Loading…</DetailState>;
  if (error || !d) {
    return <DetailState back={back}>{error ?? 'No house with that id at this estate.'}</DetailState>;
  }

  const h = d.house;
  const open = d.charges.filter((c) => c.status === 'open');
  const currency = h.currency ?? d.charges[0]?.currency ?? 'NGN';

  return (
    <>
      <div className="flex items-center justify-between">
        {back}
        <HeadActions estate={activeEstate?.estate_name ?? '—'} />
      </div>

      <DetailHead
        name={`House ${h.house_number}`}
        sub={<>House code <Code>{h.house_code}</Code> · added {dateLabel(h.created_at)}</>}
        chips={h.is_active ? <Chip tone="good">Active</Chip> : <Chip>Inactive</Chip>}
      />

      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="RESIDENTS" value={d.residents.filter((r) => r.is_active).length} />
        <Stat
          label="OUTSTANDING"
          value={formatMoney(open.reduce((n, c) => n + c.amount_minor, 0), currency)}
          tone={open.length ? 'bad' : undefined}
        />
        <Stat label="CODES · 30D" value={d.stats.codes_30d} />
        <Stat label="VISITORS ADMITTED · 30D" value={d.stats.visitors_admitted_30d} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <FieldCard title="LANDLORD">
          <Field label="NAME">{h.landlord_name ?? 'Not recorded'}</Field>
          <Field label="PHONE">{h.landlord_phone}</Field>
          <Field label="EMAIL">{h.landlord_email}</Field>
        </FieldCard>
        <FieldCard title="DUES TERMS">
          <Field label="WHO PAYS">
            {h.dues_payer ? PAYER[h.dues_payer] : 'Not billed — the estate does not collect dues'}
            {h.dues_payer && !h.dues_payer_override ? ' (estate default)' : ''}
          </Field>
          <Field label="AMOUNT A MONTH">
            {h.dues_amount_minor ? formatMoney(h.dues_amount_minor, currency) : null}
            {h.dues_amount_minor && !h.dues_amount_override ? ' (estate default)' : ''}
          </Field>
          <Field label="DAYS TO PAY">{h.grace_days}</Field>
        </FieldCard>
      </div>

      <SectionTitle>Residents</SectionTitle>
      <div className="mt-3.5">
        <DataTable
          label="Residents of this house"
          data={d.residents}
          columns={residentColumns}
          getRowId={(r) => r.membership_id}
          searchPlaceholder="Search residents by name, phone or email"
          emptyText="Nobody has joined this house yet. Share its house code to let them in."
        />
      </div>

      <SectionTitle>Dues</SectionTitle>
      <ChargeTable
        charges={d.charges}
        who={(c) => (c.subject === 'house' ? (h.landlord_name ?? 'Landlord') : (c.resident_name ?? 'Resident'))}
      />

      <SectionTitle>Payments</SectionTitle>
      <div className="mt-3.5">
        <DuesTransactions
          rows={payments}
          loading={false}
          showEstate={false}
          csvName={`house-${h.house_number}-payments.csv`}
        />
      </div>
    </>
  );
}
