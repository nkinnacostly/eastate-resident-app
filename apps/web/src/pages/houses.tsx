import { formatMoney } from '@estate/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  Button, Card, Chip, Empty, HeadActions, PageHead, Search, Stat, TableFoot,
} from '../components/ui';
import { HouseImport } from '../components/house-import';
import { Toast } from '../components/toast';
import {
  createHouse,
  getDuesConfig,
  listHouses,
  remindHouseDues,
  rotateHouseCode,
  type HouseDuesPayer,
  type HouseRow,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

// The last column fits View, Rotate code and Remind on ONE line: at 190px
// "Rotate code" wrapped onto two, and the row read as a wall of buttons.
const COLS =
  'grid grid-cols-[80px_95px_minmax(0,1.2fr)_minmax(0,1.1fr)_95px_268px] gap-4';

export function Houses() {
  const { activeEstateId, activeEstate } = useAuth();
  const [rows, setRows] = useState<HouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The estate's own currency. Hardcoding NGN would misprice every South
  // African estate on a screen that exists to show what people owe.
  const [currency, setCurrency] = useState('NGN');
  const [q, setQ] = useState('');

  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  // `payer: ''` means "follow the estate" — an absent override, not a choice
  // of neither. Kept distinct from a chosen value so the house keeps tracking
  // the estate's rate rather than freezing at today's figure.
  const [form, setForm] = useState({
    number: '', name: '', phone: '', email: '', payer: '' as '' | HouseDuesPayer, amount: '',
  });
  const [created, setCreated] = useState<{ number: string; code: string } | null>(null);

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    try {
      // In parallel: the list, and the estate's currency for rendering the
      // per-house figures. The config call is cheap and already exists.
      const [houses, cfg] = await Promise.all([
        listHouses(activeEstateId),
        getDuesConfig(activeEstateId).catch(() => null),
      ]);
      setRows(houses);
      if (cfg?.dues_currency) setCurrency(cfg.dues_currency);
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

  const remind = async (h: HouseRow) => {
    setBusyId(`remind-${h.id}`);
    setError(null);
    try {
      const n = await remindHouseDues(h.id);
      // The honest number, not "Sent". A landlord-billed house with no email
      // on record, or a resident-billed one whose residents have not joined
      // yet, reminds nobody -- and saying otherwise lets an admin believe a
      // bill has been chased when it has not.
      setNotice(
        n === 0
          ? `Nobody to remind for house ${h.house_number} — no landlord email or resident account is on record, or nothing is outstanding.`
          : `Reminded ${n} ${n === 1 ? 'person' : 'people'} about house ${h.house_number}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const add = async () => {
    if (!activeEstateId || !form.number.trim()) {
      setError('A house number is required.');
      return;
    }
    setBusyId('new');
    setError(null);
    try {
      const h = await createHouse(
        activeEstateId,
        form.number.trim(),
        form.name.trim(),
        form.phone.trim(),
        form.email.trim(),
        {
          payer: form.payer || null,
          // Typed in MAJOR units — an admin enters 25000, not 2500000. Converted
          // once, here, which is the whole reason money is stored in minor units.
          amountMinor: form.amount.trim() ? Math.round(Number(form.amount) * 100) : null,
        },
      );
      setCreated({ number: h.house_number, code: h.house_code });
      setForm({ number: '', name: '', phone: '', email: '', payer: '', amount: '' });
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
            <Button
              variant="quiet"
              onClick={() => setImporting((v) => !v)}
              className="h-[42px] px-5 text-[13.5px]"
            >
              {importing ? 'Close import' : 'Import / export'}
            </Button>
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

      {importing && activeEstateId ? (
        <HouseImport
          estateId={activeEstateId}
          estateName={activeEstate?.estate_name ?? 'estate'}
          houses={rows}
          onDone={load}
        />
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
            {/* Was never collected, and dues reminders to a landlord are EMAIL —
                so every landlord-billed house added here was unreachable by the
                one mechanism built to chase it. */}
            <label className="text-[11px] font-bold tracking-label text-muted">
              LANDLORD EMAIL
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Where dues reminders go"
                className="mt-1.5 h-11 w-full rounded-[14px] bg-field px-4 text-[13px] font-normal tracking-normal text-ink outline-none focus:ring-2 focus:ring-lime"
              />
            </label>
          </div>

          {/* ── Who pays for THIS house ──
              Asked here, while the admin is looking at the address and knows
              whether it is owner-occupied or let. Making them add the house,
              find it in a list and open another screen to say so is how houses
              end up on the wrong terms for a month. */}
          <div className="mt-5 border-t border-hair pt-4">
            <div className="text-[10.5px] font-extrabold tracking-label text-muted">
              WHO PAYS THE DUES FOR THIS HOUSE
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-muted">Billed to</span>
                <select
                  value={form.payer}
                  onChange={(e) =>
                    setForm({ ...form, payer: e.target.value as '' | HouseDuesPayer })
                  }
                  className="h-11 rounded-[14px] bg-field px-3 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-lime"
                >
                  <option value="">Same as the estate</option>
                  <option value="landlord">The landlord / owner</option>
                  <option value="residents">Each resident living here</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-muted">
                  {form.payer === 'residents' ? 'Amount per resident' : 'Amount a month'}
                </span>
                <input
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  inputMode="decimal"
                  placeholder="Same as the estate"
                  className="h-11 w-44 rounded-[14px] bg-field px-4 text-[13px] outline-none focus:ring-2 focus:ring-lime"
                />
              </label>
            </div>
            <p className="mt-2 max-w-prose text-[12px] leading-[18px] text-muted">
              {form.payer === 'residents'
                ? 'Each resident of this house is billed this amount separately — it is not a total split between them, so nobody’s bill changes when a housemate moves in or out.'
                : form.payer === 'landlord'
                  ? 'One charge for the whole house. Reminders go to the landlord’s email, and everyone living here can generate codes once it is paid.'
                  : 'Left as it is, this house follows the estate’s own dues setting — and keeps following it if the estate’s rate changes later.'}
            </p>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => void add()} disabled={busyId === 'new'}>
              {busyId === 'new' ? 'Creating…' : 'Create house'}
            </Button>
            {/* The landlord is a record, not an account — worth saying once,
                since "add a landlord" reads like it might send an invite. */}
            {/* Was "Nothing is emailed", which stopped being true the day dues
                reminders shipped. Stale reassurance is worse than none: an
                admin withholds the email that the reminders need. */}
            <span className="text-[12px] text-muted">
              The landlord is a contact on the house, not a login — they never sign in. Dues
              reminders are emailed to them if an address is given.
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

      <Toast message={notice} onDone={() => setNotice(null)} />

      <Card className="mt-3.5 py-4">
        <div className={`${COLS} px-5 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>HOUSE</span>
          <span>CODE</span>
          <span>LANDLORD</span>
          <span>DUES</span>
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
              {/* The number opens the house, and so does the View button below.
                  The number alone was not enough: a lone digit does not look
                  like something to press, and admins reported they could not
                  find the house page at all. */}
              <Link to={h.id} className="text-[13px] font-extrabold underline underline-offset-2">
                {h.house_number}
              </Link>
              <div className="text-[13px] font-extrabold tracking-code">{h.house_code}</div>
              <div className="truncate text-[13px]">
                {h.landlord_name ?? <span className="text-muted">Not recorded</span>}
              </div>
              {/* Who pays, and how much, at a glance. An admin scanning for
                  "which houses did I set up wrong" should not have to open
                  each one. */}
              <div className="truncate text-[12.5px]">
                <span className="font-bold text-ink">
                  {h.dues_payer === 'landlord'
                    ? 'Landlord'
                    : h.dues_payer === 'residents'
                      ? 'Each resident'
                      : 'Estate default'}
                </span>
                {h.dues_amount_minor ? (
                  <span className="text-muted">
                    {' · '}
                    {formatMoney(h.dues_amount_minor, currency)}
                    {h.dues_payer === 'residents' ? ' each' : ''}
                  </span>
                ) : null}
              </div>
              <div className="text-[13px] font-extrabold">
                {h.residents}
                {h.residents === 0 ? <span className="font-semibold text-muted"> none yet</span> : null}
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                {h.is_active ? null : <Chip>Inactive</Chip>}
                <Link
                  to={h.id}
                  aria-label={`View house ${h.house_number}`}
                  className="inline-flex h-7 items-center rounded-chip bg-ink px-3 text-[11px] font-extrabold text-canvas transition hover:brightness-125"
                >
                  View
                </Link>
                <Button
                  variant="quiet"
                  className="h-7 px-3 text-[11px]"
                  disabled={busyId === h.id}
                  onClick={() => void rotate(h)}
                >
                  {busyId === h.id ? 'Rotating…' : 'Rotate code'}
                </Button>
                {/* One press chases the whole house. Where the residents pay
                    there is a charge EACH, and finding every resident's row on
                    the Dues page is the kind of task that gets half-done. */}
                <Button
                  variant="quiet"
                  className="h-7 px-3 text-[11px]"
                  disabled={busyId === `remind-${h.id}`}
                  onClick={() => void remind(h)}
                >
                  {busyId === `remind-${h.id}` ? 'Sending…' : 'Remind'}
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
