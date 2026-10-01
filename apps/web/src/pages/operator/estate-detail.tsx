import { formatMoney } from '@estate/core';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  BackLink, DetailHead, DetailState, Field, FieldCard, GateEventTable, SectionTitle,
} from '../../components/detail';
import { DuesTransactions } from '../../components/dues-transactions';
import { Avatar, Card, Chip, Code, Empty, FilterChips, Stat } from '../../components/ui';
import { getOperatorEstate, type OperatorEstateDetail } from '../../lib/detail';
import { dateLabel, dayTime } from '../../lib/format';
import { listDuesTransactions, type DuesTransaction } from '../../lib/operator';
import { ago, count } from '../../lib/operator-format';

const ROLES = ['Everyone', 'Admins', 'Guards', 'Residents'] as const;
type RoleFilter = (typeof ROLES)[number];
const ROLE_OF: Record<RoleFilter, string | null> = {
  Everyone: null, Admins: 'admin', Guards: 'guard', Residents: 'resident',
};

const PEOPLE_COLS = 'grid grid-cols-[minmax(0,1.4fr)_90px_80px_minmax(0,1.2fr)_110px_90px] gap-4';
const HOUSE_COLS = 'grid grid-cols-[90px_minmax(0,1fr)_120px_90px_120px] gap-4';

const MODE: Record<string, string> = {
  none: 'Not collecting dues',
  per_house: 'Billed per house',
  per_resident: 'Billed per resident',
};

/**
 * One estate, end to end, for the platform owner: who runs it, who guards it,
 * who lives there, how busy its gate is, and where its dues money goes.
 *
 * Gate entries name the host but never the code -- the operator dashboard's
 * boundary since it was built (see Portfolio's "What you cannot see").
 */
export function EstateDetail() {
  const { estateId = '' } = useParams();
  const [d, setD] = useState<OperatorEstateDetail | null>(null);
  const [payments, setPayments] = useState<DuesTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<RoleFilter>('Everyone');

  useEffect(() => {
    if (!estateId) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const [detail, pays] = await Promise.all([
          getOperatorEstate(estateId),
          listDuesTransactions({ estateId }),
        ]);
        if (!live) return;
        setD(detail);
        setPayments(pays);
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
  }, [estateId]);

  const people = useMemo(
    () => (d?.people ?? []).filter((p) => !ROLE_OF[role] || p.role === ROLE_OF[role]),
    [d, role],
  );

  const back = <BackLink label="All estates" />;
  if (loading) return <DetailState back={back}>Loading…</DetailState>;
  if (error || !d) return <DetailState back={back}>{error ?? 'No estate with that id.'}</DetailState>;

  const e = d.estate;
  const cur = d.dues.currency ?? 'NGN';

  return (
    <>
      {back}
      <DetailHead
        name={e.name}
        sub={
          <>
            {e.address ?? 'No address'} · join code <Code>{e.join_code ?? '—'}</Code> · onboarded{' '}
            {dateLabel(e.created_at)}
          </>
        }
        chips={
          <>
            {d.gate_30d.on_duty_name ? (
              <Chip tone="good">
                {d.gate_30d.on_duty_name} on duty · {dayTime(d.gate_30d.on_duty_since)}
              </Chip>
            ) : (
              <Chip>Gate unmanned</Chip>
            )}
            {d.counts.admins === 0 ? <Chip tone="bad">No admin</Chip> : null}
          </>
        }
      />

      <div className="mt-6 grid grid-cols-6 gap-3">
        <Stat label="HOUSES" value={count(d.counts.houses)} />
        <Stat label="RESIDENTS" value={count(d.counts.residents)} />
        <Stat label="GUARDS" value={count(d.counts.guards)} />
        <Stat label="VERIFIED · 30D" value={count(d.gate_30d.verifications)} />
        <Stat label="REFUSED · 30D" value={count(d.gate_30d.refused)} />
        <Stat
          label="FLAGGED · 30D"
          value={count(d.gate_30d.flagged)}
          tone={d.gate_30d.flagged ? 'bad' : undefined}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <FieldCard title="CONTACT">
          <Field label="CONTACT">{e.contact_info}</Field>
          <Field label="LAST GATE ACTIVITY">{ago(d.gate_30d.last_activity)}</Field>
          <Field label="OFFLINE · 30D">{count(d.gate_30d.offline)}</Field>
          <Field label="SECURITY AGENCY">
            {d.agencies.find((a) => a.live)?.agency_name ?? 'Employs its own guards'}
          </Field>
        </FieldCard>
        <FieldCard title="DUES">
          <Field label="BILLING">{MODE[d.dues.billing_mode]}</Field>
          <Field label="RATE">
            {d.dues.amount_minor ? `${formatMoney(d.dues.amount_minor, cur)} / month` : null}
          </Field>
          <Field label="OUTSTANDING">
            {formatMoney(d.dues.outstanding_minor, cur)} · {d.dues.open_charges} open
          </Field>
          <Field label="COLLECTED · 30D">{formatMoney(d.dues.collected_30d_minor, cur)}</Field>
          <Field label="COMMISSION">{(Number(d.dues.platform_fee_percent) * 100).toFixed(2).replace(/\.?0+$/, '')}%</Field>
          <Field label="CODES PAUSED FOR ARREARS">{d.dues.enforcement_on ? 'Yes' : 'No'}</Field>
        </FieldCard>
        <FieldCard title="PAYOUT ACCOUNT">
          <Field label="BANK">{d.settlement.bank_name ?? 'Not set up'}</Field>
          <Field label="ACCOUNT">{d.settlement.account_mask}</Field>
          <Field label="ACCOUNT NAME">{d.settlement.account_name}</Field>
          <Field label="VERIFIED">
            {d.settlement.verified ? `Yes · ${dateLabel(d.settlement.configured_at)}` : 'No'}
          </Field>
        </FieldCard>
      </div>

      <SectionTitle right={<div className="flex gap-2"><FilterChips options={ROLES} value={role} onChange={setRole} /></div>}>
        People
      </SectionTitle>
      <Card className="mt-3.5 py-4">
        <div className={`${PEOPLE_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>NAME</span>
          <span>ROLE</span>
          <span>HOUSE</span>
          <span>EMAIL</span>
          <span>LAST SIGN-IN</span>
          <span></span>
        </div>
        {people.length === 0 ? (
          <Empty>Nobody in this group.</Empty>
        ) : (
          people.map((p) => (
            <Link
              key={p.membership_id}
              to={`/people/${p.user_id}`}
              className={`${PEOPLE_COLS} items-center border-t border-hair px-4 py-3 transition hover:bg-field/60 ${p.is_active ? '' : 'opacity-60'}`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar name={p.full_name} />
                <span className="truncate text-[13px] font-bold">{p.full_name}</span>
              </span>
              <span className="text-[12.5px] capitalize text-muted">{p.role}</span>
              <span className="text-[12.5px] text-muted">{p.house_number ?? '—'}</span>
              <span className="truncate text-[12.5px] text-muted">{p.email ?? '—'}</span>
              <span className="text-[12.5px] text-muted">{ago(p.last_sign_in_at)}</span>
              <span className="text-right text-[12px] font-bold text-muted">
                {p.is_active ? 'View →' : 'Removed'}
              </span>
            </Link>
          ))
        )}
      </Card>

      <SectionTitle>Houses</SectionTitle>
      <Card className="mt-3.5 py-4">
        <div className={`${HOUSE_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>HOUSE</span>
          <span>LANDLORD</span>
          <span>WHO PAYS</span>
          <span>RESIDENTS</span>
          <span>OUTSTANDING</span>
        </div>
        {d.houses.length === 0 ? (
          <Empty>No houses yet.</Empty>
        ) : (
          d.houses.map((h) => (
            <div key={h.house_id} className={`${HOUSE_COLS} items-center border-t border-hair px-4 py-3 ${h.is_active ? '' : 'opacity-60'}`}>
              <span className="text-[13px] font-extrabold">{h.house_number}</span>
              <span className="truncate text-[12.5px]">{h.landlord_name ?? '—'}</span>
              <span className="text-[12.5px] text-muted">
                {h.dues_payer === 'landlord' ? 'Landlord' : h.dues_payer === 'residents' ? 'Residents' : '—'}
              </span>
              <span className="text-[12.5px] text-muted">{h.residents}</span>
              <span className={`text-[12.5px] ${h.outstanding_minor > 0 ? 'font-bold text-coral-ink' : 'text-muted'}`}>
                {formatMoney(h.outstanding_minor, cur)}
              </span>
            </div>
          ))
        )}
      </Card>

      <SectionTitle>Gate activity</SectionTitle>
      <GateEventTable events={d.events} showEstate={false} />

      {d.agencies.length > 0 ? (
        <>
          <SectionTitle>Security contracts</SectionTitle>
          <Card className="mt-3.5">
            {d.agencies.map((a, i) => (
              <div key={`${a.agency_name}-${a.starts_on}`} className={`flex items-center gap-3 p-4 ${i ? 'border-t border-hair' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-extrabold">{a.agency_name}</div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    From {dateLabel(a.starts_on)}
                    {a.ends_on ? ` to ${dateLabel(a.ends_on)}` : ''}
                    {a.revoked_at ? ` · terminated ${dateLabel(a.revoked_at)}` : ''}
                  </div>
                </div>
                {a.live ? <Chip tone="good">Live</Chip> : <Chip>Ended</Chip>}
              </div>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Dues payments</SectionTitle>
      <div className="mt-3.5">
        <DuesTransactions
          rows={payments}
          loading={false}
          showEstate={false}
          csvName={`${e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-dues-payments.csv`}
        />
      </div>
    </>
  );
}
