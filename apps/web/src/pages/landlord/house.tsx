import { formatMoney } from '@estate/core';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  BackLink, ChargeTable, DetailHead, DetailState, Field, FieldCard, SectionTitle,
} from '../../components/detail';
import { Card, Chip, Empty, Stat } from '../../components/ui';
import { getLandlordHouse, type LandlordHouseDetail } from '../../lib/detail';
import { dayTime, monthLabel } from '../../lib/format';

const PAY_COLS = 'grid grid-cols-[120px_minmax(0,1.2fr)_120px_minmax(0,1fr)_100px] gap-4';

const VIA: Record<string, string> = {
  you: 'You',
  resident: 'A resident, in the app',
  pay_link: 'The payment link',
};

const PAY_STATUS: Record<string, { label: string; tone?: 'good' | 'bad' }> = {
  successful: { label: 'Paid', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  abandoned: { label: 'Abandoned' },
  initiated: { label: 'Pending' },
};

/**
 * One of the landlord's houses: its terms, every bill, and every payment
 * against it.
 *
 * Deliberately NOT here: who lives there (a count only) and anything a tenant
 * owes personally. A payment someone else made is described by how it was
 * paid, never by who -- see landlord_house_detail.
 */
export function LandlordHouse() {
  const { houseId = '' } = useParams();
  const [d, setD] = useState<LandlordHouseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!houseId) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const detail = await getLandlordHouse(houseId);
        if (!live) return;
        setD(detail);
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
  }, [houseId]);

  // The dashboard is the landlord's index, two levels up from houses/<id>.
  const back = <BackLink label="My properties" to="../.." />;
  if (loading) return <DetailState back={back}>Loading…</DetailState>;
  if (error || !d) {
    return <DetailState back={back}>{error ?? 'No house of yours with that id.'}</DetailState>;
  }

  const h = d.house;
  const cur = h.currency ?? d.charges[0]?.currency ?? 'NGN';
  const open = d.charges.filter((c) => c.status === 'open');
  const paid = d.payments.filter((p) => p.status === 'successful');
  const residentsPay = h.dues_payer === 'residents';

  return (
    <>
      {back}
      <DetailHead
        name={`House ${h.house_number}`}
        sub={h.estate_name}
        chips={
          open.length ? (
            <Chip tone="bad">{open.length} unpaid</Chip>
          ) : (
            <Chip tone="good">Clear</Chip>
          )
        }
      />

      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="RESIDENTS" value={h.residents} />
        <Stat
          label="OUTSTANDING"
          value={formatMoney(open.reduce((n, c) => n + c.amount_minor, 0), cur)}
          tone={open.length ? 'bad' : undefined}
        />
        <Stat label="PAID TO DATE" value={formatMoney(paid.reduce((n, p) => n + p.amount_minor, 0), cur)} />
        <Stat label="PAYMENTS" value={paid.length} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <FieldCard title="DUES TERMS">
          <Field label="WHO PAYS">
            {h.dues_payer === 'landlord'
              ? 'You — one bill for the house'
              : residentsPay
                ? 'Each resident pays their own'
                : 'The estate does not collect dues'}
          </Field>
          <Field label="AMOUNT">
            {h.dues_amount_minor
              ? `${formatMoney(h.dues_amount_minor, cur)} a month${residentsPay ? ' per resident' : ''}`
              : null}
          </Field>
          <Field label="DAYS TO PAY">{h.grace_days}</Field>
        </FieldCard>
        <FieldCard title="ESTATE OFFICE">
          <Field label="ESTATE">{h.estate_name}</Field>
          <Field label="CONTACT">{h.estate_contact ?? 'Not on record'}</Field>
        </FieldCard>
      </div>

      {residentsPay ? (
        <Card className="mt-4 p-4 text-[12.5px] leading-[19px] text-muted">
          The people living here are billed directly, so there is nothing for you to pay on this
          house. What each of them owes is between them and the estate, and is not shown here.
        </Card>
      ) : null}

      <SectionTitle>Bills</SectionTitle>
      <ChargeTable charges={d.charges} who={() => 'You'} />

      <SectionTitle>Payments</SectionTitle>
      <Card className="mt-3.5 py-4">
        <div className={`${PAY_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>WHEN</span>
          <span>COVERS</span>
          <span>AMOUNT</span>
          <span>PAID BY</span>
          <span>STATUS</span>
        </div>
        {d.payments.length === 0 ? (
          <Empty>No payments yet.</Empty>
        ) : (
          d.payments.map((p) => {
            const st = PAY_STATUS[p.status] ?? { label: p.status };
            return (
              <div key={p.created_at} className={`${PAY_COLS} items-center border-t border-hair px-4 py-3`}>
                <span className="text-[12.5px] text-muted">{dayTime(p.settled_at ?? p.created_at)}</span>
                <span className="text-[12.5px]">
                  {p.months > 1
                    ? `${p.months} months · ${monthLabel(p.covers_from)} – ${monthLabel(p.covers_until)}`
                    : monthLabel(p.covers_from)}
                </span>
                <span className="text-[12.5px] font-bold">{formatMoney(p.amount_minor, p.currency)}</span>
                <span className="text-[12.5px] text-muted">{VIA[p.paid_via] ?? p.paid_via}</span>
                <span><Chip tone={st.tone}>{st.label}</Chip></span>
              </div>
            );
          })
        )}
      </Card>
      <p className="mt-3 text-[11.5px] text-muted">
        Flutterwave emails a receipt to whoever paid, at the moment they pay.
      </p>
    </>
  );
}
