import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Avatar, Button, Card, Chip, Empty, PageHead, Stat } from '../../components/ui';
import {
  listRoster,
  registrationState,
  REGISTRATION_COPY,
  type RegistrationState,
  type RosterRow,
} from '../../lib/agency';
import { useAuth } from '../../lib/auth-context';
import { dayTime } from '../../lib/format';

const COLS = 'grid grid-cols-[1.5fr_120px_70px_1fr_110px] gap-4';

const TONE: Record<RegistrationState, 'good' | 'bad' | undefined> = {
  ok: 'good',
  expiring: undefined,
  unchecked: undefined,
  expired: 'bad',
  missing: 'bad',
};

/**
 * The agency's own staff, and whether their registration will stand up.
 *
 * Personal data, and legitimately so: it employs these people, and PSIRA's Code
 * clause 11(2) obliges it to have verified their registration BEFORE employing
 * them. Nothing here touches an estate's residents or visitors.
 *
 * The column that matters is the last one. Every product surveyed stores a
 * registration number and an expiry date, and an unexpired date is worth very
 * little -- it says nothing about a registration suspended yesterday. Neither
 * PSIRA nor the NSCDC publishes an API to re-check against, so "not checked
 * recently" is a real state we can show and a claim of "verified" would be a
 * lie. PSIRA's September 2026 circular tells estates to confirm that every
 * officer deployed is properly registered; this is the screen that answers it.
 */
export function AgencyOfficers() {
  const { agencies } = useAuth();
  const agency = agencies[0] ?? null;
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agency) return;
    setLoading(true);
    try {
      setRows(await listRoster(agency.agency_id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [agency]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = rows.filter((r) => r.is_active);
  const needsAttention = active.filter((r) => {
    const s = registrationState(r);
    return s !== 'ok';
  });

  return (
    <>
      <PageHead
        title="Officers"
        blurb="Everyone your agency employs, and where their registration stands. PSIRA expects the employer to have verified this before deployment, and an estate may ask to see it at the gate."
        right={
          <Button onClick={() => void load()} variant="quiet">
            Refresh
          </Button>
        }
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="ACTIVE OFFICERS" value={active.length} />
        <Stat label="POSTED AT AN ESTATE" value={active.filter((r) => r.estates_posted > 0).length} />
        <Stat
          label="REGISTRATION TO CHECK"
          value={needsAttention.length}
          tone={needsAttention.length ? 'bad' : undefined}
        />
      </div>

      <Card className="mt-6 py-4">
        <div className={`${COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>OFFICER</span>
          <span>PSIRA NUMBER</span>
          <span>GRADE</span>
          <span>REGISTRATION</span>
          <span>POSTED AT</span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>No officers yet.</Empty>
        ) : (
          rows.map((r) => {
            const state = registrationState(r);
            return (
              <div
                key={r.agency_membership_id}
                className={`${COLS} items-center border-t border-hair px-4 py-3 ${
                  r.is_active ? '' : 'opacity-50'
                }`}
              >
                <Link to={r.agency_membership_id} className="flex min-w-0 items-center gap-2.5 hover:underline">
                  <Avatar name={r.full_name ?? '?'} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold">{r.full_name ?? 'Unnamed'}</div>
                    {!r.is_active ? (
                      <div className="text-[11px] font-semibold text-muted">No longer employed</div>
                    ) : null}
                  </div>
                </Link>
                <div className="text-[12.5px] tracking-code text-muted">
                  {r.registration_number ?? '—'}
                </div>
                <div className="text-[12.5px] font-bold">{r.grade ?? '—'}</div>
                <div>
                  <Chip tone={TONE[state]}>{REGISTRATION_COPY[state]}</Chip>
                  {r.registration_checked_at ? (
                    <div className="mt-1 text-[11px] text-muted">
                      {dayTime(r.registration_checked_at)}
                    </div>
                  ) : null}
                </div>
                <div className="text-[12.5px] text-muted">
                  {r.estates_posted === 0
                    ? 'Not posted'
                    : `${r.estates_posted} estate${r.estates_posted === 1 ? '' : 's'}`}
                </div>
              </div>
            );
          })
        )}
      </Card>

      <Card className="mt-4 p-4">
        <p className="text-[12.5px] leading-[19px] text-muted">
          &ldquo;Checked&rdquo; means a person looked this up and recorded what they saw. PSIRA
          publishes no way for software to verify a registration automatically, so we do not claim
          to — check it at{' '}
          <a
            className="font-bold text-ink underline"
            href="https://digitalservices.psira.co.za/verify-user/4"
            target="_blank"
            rel="noreferrer"
          >
            PSIRA&apos;s verification page
          </a>{' '}
          or scan the QR code on the officer&apos;s card. This portal cannot record a check yet, so send the result to the myestateaccess team. Anything older than
          90 days shows as unchecked, because registration runs in 24-month cycles and renewal
          opens 90 days out.
        </p>
      </Card>
    </>
  );
}
