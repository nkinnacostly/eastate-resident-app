import { useCallback, useEffect, useState } from 'react';

import { HeadActions, Avatar, Card, Chip, Empty, PageHead, Stat } from '../components/ui';
import { listPeople, type PersonRow } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Guards() {
  const { activeEstateId, activeEstate } = useAuth();
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    try {
      setRows(await listPeople(activeEstateId, 'guard'));
    } finally {
      setLoading(false);
    }
  }, [activeEstateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = rows.filter((r) => r.is_active);

  return (
    <>
      <PageHead
        title="Guards"
        blurb="Guards who can verify codes at this estate. One guard verifies at a time — that assumption is what makes offline verification safe."
        right={<HeadActions estate={activeEstate?.estate_name ?? '—'} />}
      />

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Stat label="ACTIVE" value={active.length} />
        <Stat label="REMOVED" value={rows.length - active.length} />
      </div>

      <Card className="mt-6">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>No guards yet.</Empty>
        ) : (
          rows.map((g, i) => (
            <div
              key={g.membership_id}
              className={`flex items-center gap-3.5 p-4 ${i > 0 ? 'border-t border-hair' : ''}`}
            >
              <Avatar name={g.full_name} className="h-11 w-11 rounded-[16px] text-[13px]" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-extrabold">{g.full_name}</div>
                <div className="mt-0.5 text-[12px] text-muted">{g.phone ?? 'No phone on file'}</div>
              </div>
              {g.is_active ? <Chip tone="good">Active</Chip> : <Chip>Removed</Chip>}
            </div>
          ))
        )}
      </Card>

      {/* Explanatory, not decorative: the design shows posts, shift times and a
          handover timeline. None of that is modelled yet, so saying so beats
          rendering plausible-looking numbers. */}
      <Card className="mt-4 p-4">
        <p className="text-[12.5px] leading-[19px] text-muted">
          Shift times, gate assignments and handovers are not recorded yet — the schema has no gates
          table, so a guard belongs to an estate rather than to a post. Add gates and this page can
          show who holds which one.
        </p>
      </Card>
    </>
  );
}
