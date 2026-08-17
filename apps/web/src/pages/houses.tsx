import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Button, Card, Chip, Empty, HeadActions, PageHead, Search, Stat, TableFoot,
} from '../components/ui';
import { createHouse, listHouses, rotateHouseCode, type HouseRow } from '../lib/api';
import { useAuth } from '../lib/auth';

const COLS = 'grid grid-cols-[90px_110px_minmax(0,1.4fr)_minmax(0,1fr)_110px_120px] gap-4';

export function Houses() {
  const { activeEstateId, activeEstate } = useAuth();
  const [rows, setRows] = useState<HouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ number: '', name: '', phone: '' });
  const [created, setCreated] = useState<{ number: string; code: string } | null>(null);

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    try {
      setRows(await listHouses(activeEstateId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeEstateId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!activeEstateId || !form.number.trim()) {
      setError('A house number is required.');
      return;
    }
    setBusyId('new');
    setError(null);
    try {
      const h = await createHouse(activeEstateId, form.number.trim(), form.name.trim(), form.phone.trim());
      setCreated({ number: h.house_number, code: h.house_code });
      setForm({ number: '', name: '', phone: '' });
      setOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const rotate = async (h: HouseRow) => {
    if (
      !window.confirm(
        `Rotate the code for house ${h.house_number}? Anyone holding the old code can no longer join. Residents already approved are unaffected.`,
      )
    )
      return;
    setBusyId(h.id);
    try {
      const next = await rotateHouseCode(h.id);
      setCreated({ number: h.house_number, code: next });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const shown = useMemo(() => {
    if (!q.trim()) return rows;
    const n = q.trim().toLowerCase();
    return rows.filter((h) =>
      `${h.house_number} ${h.house_code} ${h.landlord_name ?? ''} ${h.landlord_phone ?? ''}`
        .toLowerCase()
        .includes(n),
    );
  }, [rows, q]);

  const withLandlord = rows.filter((h) => h.landlord_name).length;

  return (
    <>
      <PageHead
        title="Houses"
        blurb="Every house at this estate and its landlord. Each house has its own code — a resident types the estate code and their house code to ask to join, so the pair places them in the right home."
        right={
          <HeadActions estate={activeEstate?.estate_name ?? '—'}>
            <Button onClick={() => setOpen((v) => !v)} className="h-[42px] px-5 text-[13.5px]">
              {open ? 'Cancel' : 'Add a house'}
            </Button>
          </HeadActions>
        }
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      {created ? (
        <Card className="mt-5 flex items-center justify-between gap-4 border-lime bg-lime-soft px-5 py-4">
          <div>
            <div className="text-[13.5px] font-extrabold">
              House {created.number} — code {created.code}
            </div>
            <div className="mt-1 text-[12px] text-lime-ink">
              Give this to the landlord. Residents need it plus the estate code to join.
            </div>
          </div>
          <Button variant="quiet" onClick={() => setCreated(null)}>
            Done
          </Button>
        </Card>
      ) : null}

      {open ? (
        <Card className="mt-5 p-5">
          <div className="grid grid-cols-3 gap-3">
            <label className="text-[11px] font-bold tracking-label text-muted">
              HOUSE NUMBER
              <input
                autoFocus
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                placeholder="14"
                className="mt-1.5 h-11 w-full rounded-[14px] bg-field px-4 text-[13px] font-normal tracking-normal text-ink outline-none focus:ring-2 focus:ring-lime"
              />
            </label>
            <label className="text-[11px] font-bold tracking-label text-muted">
              LANDLORD NAME
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Optional"
                className="mt-1.5 h-11 w-full rounded-[14px] bg-field px-4 text-[13px] font-normal tracking-normal text-ink outline-none focus:ring-2 focus:ring-lime"
              />
            </label>
            <label className="text-[11px] font-bold tracking-label text-muted">
              LANDLORD PHONE
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Optional"
                className="mt-1.5 h-11 w-full rounded-[14px] bg-field px-4 text-[13px] font-normal tracking-normal text-ink outline-none focus:ring-2 focus:ring-lime"
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => void add()} disabled={busyId === 'new'}>
              {busyId === 'new' ? 'Creating…' : 'Create house'}
            </Button>
            {/* The landlord is a record, not an account — worth saying once,
                since "add a landlord" reads like it might send an invite. */}
            <span className="text-[12px] text-muted">
              The landlord is a contact on the house, not a login. Nothing is emailed.
            </span>
          </div>
        </Card>
      ) : null}

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="HOUSES" value={rows.length} />
        <Stat label="LANDLORD ON RECORD" value={`${withLandlord} of ${rows.length}`} />
        <Stat label="RESIDENTS PLACED" value={rows.reduce((n, h) => n + h.residents, 0)} />
      </div>

      <div className="mt-6 flex items-center gap-2.5">
        <Search value={q} onChange={setQ} placeholder="Search by house, code or landlord" />
      </div>

      <Card className="mt-3.5 py-4">
        <div className={`${COLS} px-5 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>HOUSE</span>
          <span>CODE</span>
          <span>LANDLORD</span>
          <span>PHONE</span>
          <span>RESIDENTS</span>
          <span></span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : shown.length === 0 ? (
          <Empty>
            {rows.length === 0
              ? 'No houses yet. Add one and its code becomes the second half of a resident join.'
              : 'No house matches that search.'}
          </Empty>
        ) : (
          shown.map((h) => (
            <div key={h.id} className={`${COLS} items-center border-t border-hair px-5 py-3.5`}>
              <div className="text-[13px] font-extrabold">{h.house_number}</div>
              <div className="text-[13px] font-extrabold tracking-code">{h.house_code}</div>
              <div className="truncate text-[13px]">
                {h.landlord_name ?? <span className="text-muted">Not recorded</span>}
              </div>
              <div className="truncate text-[12.5px] text-muted">{h.landlord_phone ?? '—'}</div>
              <div className="text-[13px] font-extrabold">
                {h.residents}
                {h.residents === 0 ? <span className="font-semibold text-muted"> none yet</span> : null}
              </div>
              <div className="flex items-center gap-2">
                {h.is_active ? null : <Chip>Inactive</Chip>}
                <Button
                  variant="quiet"
                  className="h-7 px-3 text-[11px]"
                  disabled={busyId === h.id}
                  onClick={() => void rotate(h)}
                >
                  {busyId === h.id ? 'Rotating…' : 'Rotate code'}
                </Button>
              </div>
            </div>
          ))
        )}
      </Card>

      {rows.length > 0 ? <TableFoot showing={shown.length} total={rows.length} /> : null}
    </>
  );
}
