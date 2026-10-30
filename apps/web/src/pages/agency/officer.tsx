import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  BackLink, DetailHead, DetailState, Field, FieldCard, SectionTitle, ShiftTable,
} from '../../components/detail';
import { Card, Chip, Empty, Stat } from '../../components/ui';
import { answersToPsira } from '../../lib/agency';
import { useAuth } from '../../lib/auth-context';
import { getAgencyOfficer, type AgencyOfficerDetail } from '../../lib/detail';
import { dateLabel, dayTime } from '../../lib/format';
import { ago, count } from '../../lib/operator-format';

/**
 * One of the agency's own officers.
 *
 * Their employment record, licence and attendance -- the agency's own business.
 * Gate activity is COUNTS only, and only work done under this agency's stamp:
 * no entry, resident or visitor is ever on this page (20260926140000).
 */
export function AgencyOfficer() {
  const { agencyMembershipId = '' } = useParams();
  const psira = answersToPsira(useAuth().agencies[0]);
  const [d, setD] = useState<AgencyOfficerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyMembershipId) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const detail = await getAgencyOfficer(agencyMembershipId);
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
  }, [agencyMembershipId]);

  const back = <BackLink label="All officers" />;
  if (loading) return <DetailState back={back}>Loading…</DetailState>;
  if (error || !d) return <DetailState back={back}>{error ?? 'No officer with that id.'}</DetailState>;

  const o = d.officer;
  const onDuty = d.postings.find((p) => p.on_duty_since);
  const expired = o.psira_expires_at !== null && new Date(o.psira_expires_at) < new Date();

  return (
    <>
      {back}
      <DetailHead
        name={o.full_name}
        sub={`${o.role === 'admin' ? 'Agency admin' : 'Officer'} · employed since ${dateLabel(o.joined_at)}`}
        chips={
          <>
            {onDuty ? <Chip tone="good">On duty at {onDuty.estate_name}</Chip> : null}
            {expired ? <Chip tone="bad">Licence expired</Chip> : null}
            {o.is_active ? <Chip tone="good">Employed</Chip> : <Chip>Left</Chip>}
          </>
        }
      />

      <div className="mt-6 grid grid-cols-5 gap-3">
        <Stat label="SHIFTS · 30D" value={count(d.stats_30d.shifts)} />
        <Stat label="HOURS · 30D" value={Number(d.stats_30d.hours).toLocaleString()} />
        <Stat label="ADMITTED" value={count(d.stats_30d.admitted)} />
        <Stat label="REFUSED" value={count(d.stats_30d.refused)} />
        <Stat label="FLAGGED" value={count(d.stats_30d.flagged)} tone={d.stats_30d.flagged ? 'bad' : undefined} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <FieldCard title="CONTACT">
          <Field label="PHONE">{o.phone}</Field>
          <Field label="EMAIL">{o.email}</Field>
          <Field label="LAST SIGNED IN">{o.last_sign_in_at ? ago(o.last_sign_in_at) : 'Never'}</Field>
        </FieldCard>
        <FieldCard title={psira ? 'PSIRA REGISTRATION' : 'GUARD LICENCE'}>
          <Field label="NUMBER">{o.psira_registration_number ?? 'Not recorded'}</Field>
          {psira || o.psira_grade ? <Field label="GRADE">{o.psira_grade}</Field> : null}
          <Field label="EXPIRES">
            {o.psira_expires_at ? (
              <span className={expired ? 'text-coral-ink' : undefined}>{dateLabel(o.psira_expires_at)}</span>
            ) : null}
          </Field>
          <Field label="CHECKED">{o.psira_verified_at ? dateLabel(o.psira_verified_at) : 'Not verified'}</Field>
        </FieldCard>
      </div>

      <SectionTitle>Postings</SectionTitle>
      <Card className="mt-3.5">
        {d.postings.length === 0 ? (
          <Empty>Not posted to any estate yet.</Empty>
        ) : (
          d.postings.map((p, i) => (
            <div key={p.estate_id} className={`flex items-center gap-3 p-4 ${i ? 'border-t border-hair' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-extrabold">{p.estate_name}</div>
                <div className="mt-0.5 text-[12px] text-muted">Posted {dateLabel(p.posted_at)}</div>
              </div>
              {p.on_duty_since ? <Chip tone="good">On duty · {dayTime(p.on_duty_since)}</Chip> : null}
              {p.is_active ? <Chip tone="good">Active</Chip> : <Chip>Ended</Chip>}
            </div>
          ))
        )}
      </Card>

      <SectionTitle>Shifts</SectionTitle>
      <ShiftTable shifts={d.shifts} showEstate />
    </>
  );
}
