import { MAX_ACTIVE_CODES_PER_RESIDENT } from '@estate/core';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Avatar, Button, Card, Chip, Empty, FilterChips, HeadActions, PageHead, Search, Stat, TableFoot,
} from '../components/ui';
import {
  approveRequest, declineRequest, deactivateMembership, listPending, listPeople,
  type PendingRow, type PersonRow,
} from '../lib/api';
import { useAuth } from '../lib/auth';

const COLS = 'grid grid-cols-[90px_minmax(0,1.5fr)_minmax(0,1.2fr)_100px_170px] gap-4';
const FILTERS = ['All', 'Approved', 'At cap', 'Suspended'] as const;
type Filter = (typeof FILTERS)[number];

export function Residents() {
  const { activeEstateId, activeEstate } = useAuth();
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('All');

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([
        listPeople(activeEstateId, 'resident'),
        listPending(activeEstateId),
      ]);
      setPeople(p);
      setPending(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeEstateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (fn: () => Promise<void>, id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const atCap = (p: PersonRow) => p.is_active && p.live_codes >= MAX_ACTIVE_CODES_PER_RESIDENT;

  const shown = useMemo(
    () =>
      people.filter((p) => {
        const byFilter =
          filter === 'All' ||
          (filter === 'Approved' && p.is_active) ||
          (filter === 'At cap' && atCap(p)) ||
          (filter === 'Suspended' && !p.is_active);
        if (!byFilter) return false;
        if (!q.trim()) return true;
        return `${p.full_name} ${p.unit ?? ''} ${p.phone ?? ''}`
          .toLowerCase()
          .includes(q.trim().toLowerCase());
      }),
    [people, filter, q],
  );

  const approved = people.filter((p) => p.is_active);

  return (
    <>
      <PageHead
        title="Residents"
        blurb="Everyone approved to make codes at this estate. Suspending a resident stops them making new ones; codes already issued stay valid until they expire or are revoked."
        right={<HeadActions estate={activeEstate?.estate_name ?? '—'} />}
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-4 gap-3">
        <Stat label="APPROVED" value={approved.length} />
        <Stat
          label="AWAITING APPROVAL"
          value={pending.length}
          tone={pending.length ? 'bad' : undefined}
        />
        <Stat label="AT THE CAP" value={approved.filter(atCap).length} />
        <Stat label="SUSPENDED" value={people.length - approved.length} />
      </div>

      {/* Pending sits above the roll: it is the only thing here needing a
          decision today, and burying it under 200 approved residents is how
          requests rot. */}
      {pending.length > 0 ? (
        <>
          <h2 className="mt-8 text-[16.5px] font-extrabold">Awaiting approval</h2>
          <Card className="mt-3.5">
            {pending.map((r, i) => (
              <div
                key={r.id}
                className={`flex items-center gap-3.5 px-5 py-4 ${i > 0 ? 'border-t border-hair' : ''}`}
              >
                <Avatar name={r.full_name} className="h-9 w-9 rounded-[12px] text-[12px]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-bold">{r.full_name}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">
                    {/* Resolved from the house CODE they typed, so this is a
                        fact rather than a claim — which is why it no longer
                        says "claims". */}
                    House {r.requested_unit ?? '—'}
                    {r.phone ? ` · ${r.phone}` : ''}
                  </div>
                </div>
                <Button
                  variant="quiet"
                  disabled={busyId === r.id}
                  onClick={() => void decide(() => declineRequest(r.id, ''), r.id)}
                >
                  Decline
                </Button>
                <Button
                  disabled={busyId === r.id}
                  onClick={() => void decide(() => approveRequest(r.id), r.id)}
                >
                  {busyId === r.id ? 'Working…' : `Approve for house ${r.requested_unit ?? '—'}`}
                </Button>
              </div>
            ))}
          </Card>
        </>
      ) : null}

      <div className="mt-6 flex items-center gap-2.5">
        <Search value={q} onChange={setQ} placeholder="Search by name, house or phone" />
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
      </div>

      <Card className="mt-3.5 py-4">
        <div className={`${COLS} px-5 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>HOUSE</span>
          <span>RESIDENT</span>
          <span>PHONE</span>
          <span>CODES</span>
          <span>STATUS</span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : shown.length === 0 ? (
          <Empty>
            {people.length === 0
              ? 'No residents yet. They appear here once you approve a request.'
              : 'Nobody matches that search.'}
          </Empty>
        ) : (
          shown.map((p) => (
            <div key={p.membership_id} className={`${COLS} items-center border-t border-hair px-5 py-3.5`}>
              <div className="text-[13px] font-extrabold">{p.unit ?? '—'}</div>
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={p.full_name} />
                <span className="truncate text-[13.5px] font-bold">{p.full_name}</span>
              </div>
              <div className="truncate text-[12.5px] text-muted">{p.phone ?? '—'}</div>
              <div className="text-[13px] font-extrabold">
                {p.live_codes}
                <span className="font-semibold text-muted">/{MAX_ACTIVE_CODES_PER_RESIDENT}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                {!p.is_active ? (
                  <Chip>Suspended</Chip>
                ) : atCap(p) ? (
                  <Chip tone="bad">At cap</Chip>
                ) : (
                  <Chip tone="good">Approved</Chip>
                )}
                {p.is_active ? (
                  <Button
                    variant="quiet"
                    className="h-7 px-3 text-[11px]"
                    disabled={busyId === p.membership_id}
                    onClick={() =>
                      void decide(() => deactivateMembership(p.membership_id), p.membership_id)
                    }
                  >
                    Suspend
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Card>

      {people.length > 0 ? <TableFoot showing={shown.length} total={people.length} /> : null}
    </>
  );
}
