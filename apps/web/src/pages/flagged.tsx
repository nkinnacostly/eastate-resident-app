import { useCallback, useEffect, useState } from 'react';

import { Card, Chip, Empty, HeadActions, PageHead, Stat } from '../components/ui';
import { listEvents, type EventRow } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dayTime } from '../lib/format';

/**
 * 'flagged' is not a stored outcome. It is DERIVED: an admitted event that
 * replayed from a device and resolved to no code — i.e. the guard used the
 * admit-and-flag fallback. Deriving it beats adding a column that could drift
 * out of step with the event it describes.
 */
export function isFlagged(e: EventRow): boolean {
  return e.outcome === 'admitted' && e.source === 'offline_replay' && !e.host_name;
}

export function Flagged() {
  const { activeEstateId, activeEstate } = useAuth();
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    try {
      setRows(await listEvents(activeEstateId, 200));
    } finally {
      setLoading(false);
    }
  }, [activeEstateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const flagged = rows.filter(isFlagged);
  const queued = rows.filter((e) => !e.synced_at);

  return (
    <>
      <PageHead
        title="Flagged entries"
        blurb="Codes a guard admitted without a match, usually because the gate had no signal. Each one carries the guard's name and the time from their device."
        right={<HeadActions estate={activeEstate?.estate_name ?? '—'} />}
      />

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="FLAGGED" value={flagged.length} tone={flagged.length ? 'bad' : undefined} />
        <Stat label="STILL UPLOADING" value={queued.length} />
        <Stat label="ENTRIES SEEN" value={rows.length} />
      </div>

      <Card className="mt-6">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : flagged.length === 0 ? (
          <Empty>
            Nothing flagged. Entries appear here only when a guard admits a code the phone could
            not match.
          </Empty>
        ) : (
          flagged.map((e, i) => (
            <div key={e.id} className={`px-5 py-4 ${i > 0 ? 'border-t border-hair' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[19px] font-extrabold tracking-code">
                      {e.code ?? '—'}
                    </span>
                    <Chip tone="bad">FLAGGED</Chip>
                  </div>
                  <div className="mt-1.5 text-[12px] text-muted">
                    {dayTime(e.verified_at)} · {e.guard_name}
                    {e.synced_at ? '' : ' · still uploading'}
                  </div>
                </div>
              </div>
              <p className="mt-3 border-t border-hair pt-3 text-[12.5px] leading-[19px] text-muted">
                No matching code on the device. Admitted on the guard&apos;s judgement while the
                gate was offline.
              </p>
            </div>
          ))
        )}
      </Card>

      {/* Explanatory: accept/escalate needs somewhere to record the decision,
          and verification_events is append-only by design. */}
      <Card className="mt-4 p-4">
        <p className="text-[12.5px] leading-[19px] text-muted">
          Accepting or escalating a flagged entry is not built yet. Verification records are
          append-only, so a decision needs its own table rather than an edit to the event — which
          would destroy the very record an admin is reviewing.
        </p>
      </Card>
    </>
  );
}
