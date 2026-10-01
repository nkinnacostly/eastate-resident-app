import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  DetailHead, DetailState, Field, FieldCard, GateEventTable, SectionTitle, ShiftTable,
} from '../../components/detail';
import { Card, Chip, Empty, Stat } from '../../components/ui';
import { getOperatorPerson, type OperatorPersonDetail } from '../../lib/detail';
import { dateLabel, dayTime } from '../../lib/format';
import { ago, count } from '../../lib/operator-format';

const ROLE_LABEL: Record<string, string> = { resident: 'Resident', guard: 'Guard', admin: 'Estate admin' };

/**
 * One human across the whole platform.
 *
 * Per person, not per membership: the same account can be a resident at one
 * estate, a guard at another and an agency officer, and the operator is the
 * only role entitled to see all of that together.
 */
export function Person() {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState<OperatorPersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const detail = await getOperatorPerson(userId);
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
  }, [userId]);

  // Back to wherever they came from -- an estate, the admins list or a search.
  const back = (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="text-[12.5px] font-bold text-muted hover:text-ink"
    >
      ← Back
    </button>
  );
  if (loading) return <DetailState back={back}>Loading…</DetailState>;
  if (error || !d) return <DetailState back={back}>{error ?? 'No account with that id.'}</DetailState>;

  const p = d.person;
  const guard = d.guard;
  const totals = guard.reduce(
    (t, g) => ({
      verified: t.verified + g.verifications_30d,
      flagged: t.flagged + g.flagged_30d,
      hours: t.hours + Number(g.hours_on_duty_30d),
      shifts: t.shifts + g.shifts_30d,
    }),
    { verified: 0, flagged: 0, hours: 0, shifts: 0 },
  );
  const licenceExpired = p.psira_expires_at !== null && new Date(p.psira_expires_at) < new Date();

  return (
    <>
      {back}
      <DetailHead
        name={p.full_name}
        sub={p.email ?? 'No email'}
        chips={
          <>
            {p.is_platform_admin ? <Chip tone="on">Platform owner</Chip> : null}
            {guard.find((g) => g.on_duty_since) ? <Chip tone="good">On duty</Chip> : null}
            {p.email_confirmed ? null : <Chip tone="bad">Email unconfirmed</Chip>}
          </>
        }
      />

      {guard.length > 0 ? (
        <div className="mt-6 grid grid-cols-4 gap-3">
          <Stat label="VERIFIED · 30D" value={count(totals.verified)} />
          <Stat label="FLAGGED · 30D" value={count(totals.flagged)} tone={totals.flagged ? 'bad' : undefined} />
          <Stat label="HOURS ON DUTY · 30D" value={totals.hours.toLocaleString()} />
          <Stat label="SHIFTS · 30D" value={count(totals.shifts)} />
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-4">
        <FieldCard title="CONTACT & ACCOUNT">
          <Field label="PHONE">{p.phone}</Field>
          <Field label="EMAIL">{p.email}</Field>
          <Field label="LAST SIGNED IN">{p.last_sign_in_at ? ago(p.last_sign_in_at) : 'Never'}</Field>
          <Field label="EMAIL CONFIRMED">{p.email_confirmed ? 'Yes' : 'No'}</Field>
        </FieldCard>
        <FieldCard title="SECURITY LICENCE">
          <Field label="PSIRA NUMBER">{p.psira_registration_number ?? 'Not recorded'}</Field>
          <Field label="GRADE">{p.psira_grade}</Field>
          <Field label="EXPIRES">
            {p.psira_expires_at ? (
              <span className={licenceExpired ? 'text-coral-ink' : undefined}>
                {dateLabel(p.psira_expires_at)}
                {licenceExpired ? ' · expired' : ''}
              </span>
            ) : null}
          </Field>
          <Field label="CHECKED">{p.psira_verified_at ? dateLabel(p.psira_verified_at) : 'Not verified'}</Field>
        </FieldCard>
      </div>

      <SectionTitle>Estates</SectionTitle>
      <Card className="mt-3.5">
        {d.memberships.length === 0 ? (
          <Empty>Not a member of any estate.</Empty>
        ) : (
          d.memberships.map((m, i) => {
            const g = guard.find((x) => x.membership_id === m.membership_id);
            return (
              <Link
                key={m.membership_id}
                to={`/estates/${m.estate_id}`}
                className={`flex items-center gap-3 p-4 transition hover:bg-field/60 ${i ? 'border-t border-hair' : ''} ${m.is_active ? '' : 'opacity-60'}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-extrabold">{m.estate_name}</div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {ROLE_LABEL[m.role]}
                    {m.house_number ? ` · house ${m.house_number}` : ''}
                    {m.agency_name ? ` · placed by ${m.agency_name}` : ''}
                    {` · since ${dateLabel(m.joined_at)}`}
                    {g ? ` · ${g.verifications_30d} verified, ${Number(g.hours_on_duty_30d)}h on duty (30d)` : ''}
                  </div>
                </div>
                {g?.on_duty_since ? <Chip tone="good">On duty · {dayTime(g.on_duty_since)}</Chip> : null}
                {m.is_active ? <Chip tone="good">Active</Chip> : <Chip>Removed</Chip>}
              </Link>
            );
          })
        )}
      </Card>

      {d.agencies.length > 0 ? (
        <>
          <SectionTitle>Security agencies</SectionTitle>
          <Card className="mt-3.5">
            {d.agencies.map((a, i) => (
              <div key={a.agency_name} className={`flex items-center gap-3 p-4 ${i ? 'border-t border-hair' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-extrabold">{a.agency_name}</div>
                  <div className="mt-0.5 text-[12px] capitalize text-muted">
                    {a.role} · since {dateLabel(a.joined_at)}
                  </div>
                </div>
                {a.is_active ? <Chip tone="good">Employed</Chip> : <Chip>Left</Chip>}
              </div>
            ))}
          </Card>
        </>
      ) : null}

      {guard.length > 0 ? (
        <>
          <SectionTitle>Shifts</SectionTitle>
          <ShiftTable shifts={d.shifts} showEstate={guard.length > 1} />
          <SectionTitle>Recent verifications</SectionTitle>
          <GateEventTable events={d.events} showEstate />
        </>
      ) : null}
    </>
  );
}
