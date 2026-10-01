import { formatMoney } from '@estate/core';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  BackLink, ChargeTable, DetailHead, DetailState, Field, FieldCard, SectionTitle,
} from '../components/detail';
import { DuesTransactions } from '../components/dues-transactions';
import { Avatar, Card, Chip, Code, Empty, HeadActions, Stat } from '../components/ui';
import { listEstateDuesPayments } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { getHouseDetail, type HouseDetail } from '../lib/detail';
import { dateLabel } from '../lib/format';
import type { DuesTransaction } from '../lib/operator';

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
      <Card className="mt-3.5">
        {d.residents.length === 0 ? (
          <Empty>Nobody has joined this house yet. Share its house code to let them in.</Empty>
        ) : (
          d.residents.map((r, i) => (
            <Link
              key={r.membership_id}
              to={`../../residents/${r.membership_id}`}
              relative="path"
              className={`flex items-center gap-3.5 p-4 transition hover:bg-field/60 ${i > 0 ? 'border-t border-hair' : ''}`}
            >
              <Avatar name={r.full_name} />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-extrabold">{r.full_name}</div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {r.phone ?? 'No phone'} · joined {dateLabel(r.joined_at)}
                </div>
              </div>
              {r.is_active ? <Chip tone="good">Active</Chip> : <Chip>Suspended</Chip>}
              <span className="text-[12px] font-bold text-muted">View →</span>
            </Link>
          ))
        )}
      </Card>

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
