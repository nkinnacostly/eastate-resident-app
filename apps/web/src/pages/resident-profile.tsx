import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  BackLink, ChargeTable, DetailHead, DetailState, Field, FieldCard, SectionTitle,
} from '../components/detail';
import { DuesTransactions } from '../components/dues-transactions';
import { Card, Chip, Code, Empty, HeadActions, Stat } from '../components/ui';
import { listEstateDuesPayments } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { getResidentDetail, type ResidentDetail } from '../lib/detail';
import { dateLabel, dayTime } from '../lib/format';
import type { DuesTransaction } from '../lib/operator';
import { ago } from '../lib/operator-format';

const CODE_COLS = 'grid grid-cols-[110px_minmax(0,1fr)_1fr_1fr_100px] gap-4';

const CODE_STATUS: Record<string, { label: string; tone?: 'good' | 'bad' }> = {
  active: { label: 'Live', tone: 'good' },
  used: { label: 'Used' },
  expired: { label: 'Expired' },
  revoked: { label: 'Cancelled', tone: 'bad' },
};

/**
 * One resident, as their estate admin sees them: who they are, where they
 * live, what they have issued at the gate, and what they owe and paid.
 */
export function ResidentProfile() {
  const { membershipId = '' } = useParams();
  const { activeEstateId, activeEstate } = useAuth();
  const [d, setD] = useState<ResidentDetail | null>(null);
  const [payments, setPayments] = useState<DuesTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeEstateId || !membershipId) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const [detail, pays] = await Promise.all([
          getResidentDetail(activeEstateId, membershipId),
          listEstateDuesPayments(activeEstateId, null),
        ]);
        if (!live) return;
        setD(detail);
        // Payments against THIS resident's charges -- including the house bill
        // where the landlord is billed, since that is the one that pauses them.
        const mine = new Set((detail?.charges ?? []).map((c) => c.charge_id));
        setPayments(pays.filter((p) => mine.has(p.charge_id)));
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
  }, [activeEstateId, membershipId]);

  const back = <BackLink label="All residents" />;
  if (loading) return <DetailState back={back}>Loading…</DetailState>;
  if (error || !d) {
    return <DetailState back={back}>{error ?? 'No resident with that id at this estate.'}</DetailState>;
  }

  const p = d.person;
  return (
    <>
      <div className="flex items-center justify-between">
        {back}
        <HeadActions estate={activeEstate?.estate_name ?? '—'} />
      </div>

      <DetailHead
        name={p.full_name}
        sub={
          <>
            {p.house_number ? (
              <Link to={`../../houses/${p.house_id}`} relative="path" className="font-bold text-ink underline">
                House {p.house_number}
              </Link>
            ) : (p.unit ?? 'No house on record')}
            {` · resident since ${dateLabel(p.joined_at)}`}
          </>
        }
        chips={
          <>
            {d.stats.in_arrears ? <Chip tone="bad">Dues overdue</Chip> : null}
            {p.is_active ? <Chip tone="good">Active</Chip> : <Chip>Suspended</Chip>}
          </>
        }
      />

      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="LIVE CODES" value={d.stats.live_codes} />
        <Stat label="CODES · 30D" value={d.stats.codes_30d} />
        <Stat label="VISITORS ADMITTED · 30D" value={d.stats.visitors_admitted_30d} />
        <Stat label="DELIVERIES · 30D" value={d.stats.deliveries_30d} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <FieldCard title="CONTACT & ACCOUNT">
          <Field label="PHONE">{p.phone}</Field>
          <Field label="SIGN-IN EMAIL">{p.email}</Field>
          <Field label="LAST SIGNED IN">{p.last_sign_in_at ? ago(p.last_sign_in_at) : 'Never'}</Field>
          <Field label="LAST CODE">{d.stats.last_code_at ? ago(d.stats.last_code_at) : 'None yet'}</Field>
        </FieldCard>
        <FieldCard title="HOUSEHOLD & DUES">
          <Field label="DUES PAID BY">
            {p.dues_payer === 'landlord' ? 'The landlord (house bill)' : 'This resident'}
          </Field>
          <Field label="OUTSTANDING">
            {d.charges.filter((c) => c.status === 'open').length} open
          </Field>
          <Field label="LIVES WITH">
            {d.household.length === 0
              ? 'Nobody else on record'
              : d.household.map((h, i) => (
                  <span key={h.membership_id}>
                    {i > 0 ? ', ' : ''}
                    <Link to={`../${h.membership_id}`} relative="path" className="underline">
                      {h.full_name}
                    </Link>
                  </span>
                ))}
          </Field>
        </FieldCard>
      </div>

      <SectionTitle>Codes issued</SectionTitle>
      <Card className="mt-3.5 py-4">
        <div className={`${CODE_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>CODE</span>
          <span>FOR</span>
          <span>CREATED</span>
          <span>EXPIRES / USED</span>
          <span>STATUS</span>
        </div>
        {d.codes.length === 0 ? (
          <Empty>No codes issued.</Empty>
        ) : (
          d.codes.map((c) => {
            const st = CODE_STATUS[c.status] ?? { label: c.status };
            return (
              <div key={c.id} className={`${CODE_COLS} items-center border-t border-hair px-4 py-3`}>
                <span className="text-[13px]"><Code>{c.code}</Code></span>
                <span className="truncate text-[12.5px] text-muted">
                  {c.is_delivery ? `Delivery${c.delivery_note ? ` · ${c.delivery_note}` : ''}` : 'Visitor'}
                </span>
                <span className="text-[12.5px] text-muted">{dayTime(c.created_at)}</span>
                <span className="text-[12.5px] text-muted">
                  {c.used_at ? `Used ${dayTime(c.used_at)}` : dayTime(c.expires_at)}
                </span>
                <span><Chip tone={st.tone}>{st.label}</Chip></span>
              </div>
            );
          })
        )}
      </Card>

      <SectionTitle>Dues</SectionTitle>
      <ChargeTable
        charges={d.charges}
        who={(c) => (c.subject === 'house' ? `House ${p.house_number ?? ''} (landlord)` : p.full_name)}
      />

      <SectionTitle>Payments</SectionTitle>
      <div className="mt-3.5">
        <DuesTransactions
          rows={payments}
          loading={false}
          showEstate={false}
          csvName={`${p.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-payments.csv`}
        />
      </div>
    </>
  );
}
