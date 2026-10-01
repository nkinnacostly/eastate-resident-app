import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { BackLink, DetailHead, DetailState, SectionTitle } from '../../components/detail';
import { Avatar, Card, Chip, Empty, Stat } from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import { getAgencyEstate, type AgencyEstateDetail } from '../../lib/detail';
import { dateLabel, monthLabel } from '../../lib/format';
import { count } from '../../lib/operator-format';

const MONTH_COLS = 'grid grid-cols-[110px_repeat(5,minmax(0,1fr))] gap-4';

/**
 * An estate the agency guards: the contract, who it has posted there, and six
 * months of the service as counts. Nothing about who lives there or who came
 * through the gate -- see 20260926140000 for why that is a legal line.
 */
export function AgencyEstate() {
  const { estateId = '' } = useParams();
  const { agencies } = useAuth();
  const agency = agencies[0] ?? null;
  const [d, setD] = useState<AgencyEstateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agency || !estateId) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const detail = await getAgencyEstate(agency.agency_id, estateId);
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
  }, [agency, estateId]);

  // Coverage lives at the agency's index, one level up from estates/<id>.
  const back = <BackLink label="Coverage" to="../.." />;
  if (loading) return <DetailState back={back}>Loading…</DetailState>;
  if (error || !d) {
    return <DetailState back={back}>{error ?? 'Your agency holds no contract at that estate.'}</DetailState>;
  }

  const live = d.contracts.find((c) => c.live);
  const thisMonth = d.monthly[0];

  return (
    <>
      {back}
      <DetailHead
        name={d.estate.name}
        sub={d.estate.address ?? undefined}
        chips={live ? <Chip tone="good">Contract live</Chip> : <Chip>Contract ended</Chip>}
      />

      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="OFFICERS POSTED" value={d.officers.filter((o) => o.is_active).length} />
        <Stat label="ON DUTY NOW" value={d.officers.filter((o) => o.on_duty).length} />
        <Stat label="HOURS · THIS MONTH" value={Number(thisMonth?.hours ?? 0).toLocaleString()} />
        <Stat
          label="FLAGGED · THIS MONTH"
          value={count(thisMonth?.flagged ?? 0)}
          tone={thisMonth?.flagged ? 'bad' : undefined}
        />
      </div>

      <SectionTitle>Officers posted here</SectionTitle>
      <Card className="mt-3.5">
        {d.officers.length === 0 ? (
          <Empty>No officers posted yet.</Empty>
        ) : (
          d.officers.map((o, i) => {
            const row = (
              <>
                <Avatar name={o.full_name} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-extrabold">{o.full_name}</div>
                  <div className="mt-0.5 text-[12px] text-muted">Posted {dateLabel(o.posted_at)}</div>
                </div>
                {o.on_duty ? <Chip tone="good">On duty</Chip> : null}
                {o.is_active ? <Chip tone="good">Active</Chip> : <Chip>Ended</Chip>}
              </>
            );
            const cls = `flex items-center gap-3.5 p-4 ${i ? 'border-t border-hair' : ''}`;
            return o.agency_membership_id ? (
              <Link
                key={o.agency_membership_id}
                to={`../../officers/${o.agency_membership_id}`}
                relative="path"
                className={`${cls} transition hover:bg-field/60`}
              >
                {row}
              </Link>
            ) : (
              <div key={`${o.full_name}-${o.posted_at}`} className={cls}>{row}</div>
            );
          })
        )}
      </Card>

      <SectionTitle>Service by month</SectionTitle>
      <Card className="mt-3.5 py-4">
        <div className={`${MONTH_COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>MONTH</span>
          <span>SHIFTS</span>
          <span>HOURS</span>
          <span>ADMITTED</span>
          <span>REFUSED</span>
          <span>FLAGGED</span>
        </div>
        {d.monthly.map((m) => (
          <div key={m.month} className={`${MONTH_COLS} items-center border-t border-hair px-4 py-3`}>
            <span className="text-[12.5px] font-bold">{monthLabel(m.month)}</span>
            <span className="text-[12.5px] text-muted">{count(m.shifts)}</span>
            <span className="text-[12.5px] text-muted">{Number(m.hours).toLocaleString()}</span>
            <span className="text-[12.5px] text-muted">{count(m.admitted)}</span>
            <span className="text-[12.5px] text-muted">{count(m.refused)}</span>
            <span className={`text-[12.5px] ${m.flagged ? 'font-bold text-coral-ink' : 'text-muted'}`}>
              {count(m.flagged)}
            </span>
          </div>
        ))}
      </Card>

      <SectionTitle>Contract history</SectionTitle>
      <Card className="mt-3.5">
        {d.contracts.map((c, i) => (
          <div key={c.starts_on} className={`flex items-center gap-3 p-4 ${i ? 'border-t border-hair' : ''}`}>
            <div className="min-w-0 flex-1 text-[13px] font-semibold">
              From {dateLabel(c.starts_on)}
              {c.ends_on ? ` to ${dateLabel(c.ends_on)}` : ' · open-ended'}
              {c.revoked_at ? ` · terminated ${dateLabel(c.revoked_at)}` : ''}
            </div>
            {c.live ? <Chip tone="good">Live</Chip> : <Chip>Ended</Chip>}
          </div>
        ))}
      </Card>
    </>
  );
}
