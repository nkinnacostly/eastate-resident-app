import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Card, Chip, Empty, PageHead, Stat } from '../components/ui';
import { listCodes, listEvents, listPending, type EventRow } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dayTime, outcomeLabel } from '../lib/format';

export function Overview() {
  const { activeEstate, activeEstateId, session } = useAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [liveCodes, setLiveCodes] = useState(0);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    try {
      const [ev, codes, pend] = await Promise.all([
        listEvents(activeEstateId, 50),
        listCodes(activeEstateId, 200),
        listPending(activeEstateId),
      ]);
      setEvents(ev);
      setLiveCodes(codes.filter((c) => c.status === 'live').length);
      setPending(pend.length);
    } finally {
      setLoading(false);
    }
  }, [activeEstateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const name = (session?.user.user_metadata?.full_name as string | undefined) ?? '';
  const first = name.split(' ')[0] || 'there';

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const today = events.filter((e) => new Date(e.verified_at) >= since);
  const admitted = today.filter((e) => e.outcome === 'admitted').length;
  const refused = today.filter((e) => e.outcome === 'rejected' || e.outcome === 'collision').length;
  const queued = events.filter((e) => !e.synced_at).length;

  return (
    <>
      <PageHead
        title={`Welcome back, ${first}`}
        blurb={`What has happened at ${activeEstate?.estate_name ?? 'this estate'} today.`}
      />

      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="ADMITTED TODAY" value={admitted} />
        <Stat label="REFUSED TODAY" value={refused} />
        <Stat label="LIVE CODES" value={liveCodes} />
        <Stat
          label="AWAITING APPROVAL"
          value={pending}
          tone={pending > 0 ? 'bad' : undefined}
        />
      </div>

      {pending > 0 ? (
        <Link
          to="/residents"
          className="mt-4 flex items-center justify-between rounded-card bg-ink px-5 py-4 text-canvas"
        >
          <div>
            <div className="text-[13.5px] font-extrabold">
              {pending} {pending === 1 ? 'person is' : 'people are'} waiting to be approved
            </div>
            <div className="mt-1 text-[12px] text-muted-2">
              They cannot make codes until you decide.
            </div>
          </div>
          <span className="text-[12.5px] font-bold text-lime">Review →</span>
        </Link>
      ) : null}

      {queued > 0 ? (
        <Card className="mt-4 border-coral-soft p-4">
          <p className="text-[12.5px] text-coral-ink">
            {queued} {queued === 1 ? 'verification has' : 'verifications have'} not reached the
            server yet. They are held on a guard&apos;s phone and upload when it regains signal.
          </p>
        </Card>
      ) : null}

      <h2 className="mt-8 text-[16.5px] font-extrabold">Last entries</h2>
      <Card className="mt-3.5">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : events.length === 0 ? (
          <Empty>Nothing has come through the gate yet.</Empty>
        ) : (
          events.slice(0, 8).map((e, i) => (
            <div
              key={e.id}
              className={`flex items-center gap-3.5 p-4 ${i > 0 ? 'border-t border-hair' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-extrabold tracking-code">{e.code ?? '—'}</div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted">
                  {e.host_name ? `${e.host_name}${e.host_unit ? `, ${e.host_unit}` : ''} · ` : ''}
                  {e.guard_name}
                </div>
              </div>
              {e.outcome === 'admitted' ? (
                <Chip tone="good">Admitted</Chip>
              ) : (
                <Chip>{outcomeLabel(e.outcome, e.reject_reason)}</Chip>
              )}
              <div className="w-16 text-right text-[12.5px] font-bold text-muted">
                {dayTime(e.verified_at)}
              </div>
            </div>
          ))
        )}
      </Card>
    </>
  );
}
