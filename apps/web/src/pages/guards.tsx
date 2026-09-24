import { useCallback, useEffect, useState } from 'react';

import { HeadActions, Avatar, Button, Card, Chip, Empty, PageHead, Stat } from '../components/ui';
import {
  currentShift,
  listPeople,
  onboardGuard,
  type CurrentShift,
  type OnboardGuardResult,
  type PersonRow,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

const field =
  'mt-1.5 h-11 w-full rounded-[14px] bg-field px-4 text-[13px] font-normal tracking-normal text-ink outline-none focus:ring-2 focus:ring-lime';
const label = 'text-[11px] font-bold tracking-label text-muted';

/** How long the current guard has held the gate, in words an admin reads at a glance. */
function heldFor(since: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * The handover panel.
 *
 * Shown once, after registering a guard, and never retrievable: the password is
 * not stored anywhere in readable form — it went straight into the auth system
 * as a hash. If this is dismissed before it is written down, the fix is to
 * reset the password, not to look it up.
 */
function Handover({ result, onDone }: { result: OnboardGuardResult; onDone: () => void }) {
  return (
    <Card className="mt-5 border-lime bg-lime-soft p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-extrabold">
            {result.full_name ?? result.email} can now work the gate
          </div>
          <div className="mt-1 text-[12px] leading-[1.5] text-lime-ink">
            {result.reused_existing_account
              ? 'That address already had an account, so it keeps its existing password. This estate will be waiting when they sign in to the guard app.'
              : 'Hand these to the guard. The password is shown once and cannot be looked up later — it was hashed on the way in.'}
            {result.welcome_email_queued
              ? ' We have also emailed them a link to set their own password.'
              : ' We could not queue their welcome email, so the details above are the only handover.'}
          </div>
        </div>
        <Button variant="quiet" onClick={onDone}>
          Done
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-[14px] bg-white px-4 py-3">
          <div className={label}>EMAIL</div>
          <div className="mt-1 text-[13px] font-bold break-all">{result.email}</div>
        </div>
        {result.password ? (
          <div className="rounded-[14px] bg-white px-4 py-3">
            <div className={label}>PASSWORD</div>
            <div className="mt-1 font-mono text-[13px] font-bold tracking-wider">
              {result.password}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function Guards() {
  const { activeEstateId, activeEstate } = useAuth();
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [shift, setShift] = useState<CurrentShift | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [created, setCreated] = useState<OnboardGuardResult | null>(null);

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    try {
      // Together: a guards list that disagrees with the on-duty panel about who
      // exists would be worse than either alone.
      const [people, duty] = await Promise.all([
        listPeople(activeEstateId, 'guard'),
        currentShift(activeEstateId),
      ]);
      setRows(people);
      setShift(duty);
    } finally {
      setLoading(false);
    }
  }, [activeEstateId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!activeEstateId) return;
    setError(null);
    setBusy(true);
    try {
      const res = await onboardGuard({
        estate_id: activeEstateId,
        email: form.email.trim(),
        full_name: form.name.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
      setCreated(res);
      setForm({ name: '', email: '', phone: '' });
      setOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not register that guard.');
    } finally {
      setBusy(false);
    }
  }

  const active = rows.filter((r) => r.is_active);

  return (
    <>
      <PageHead
        title="Guards"
        blurb="Guards who can verify codes at this estate. One guard verifies at a time — that assumption is what makes offline verification safe."
        right={
          <HeadActions estate={activeEstate?.estate_name ?? '—'}>
            <Button onClick={() => setOpen((v) => !v)} className="h-[42px] px-5 text-[13.5px]">
              {open ? 'Cancel' : 'Register a guard'}
            </Button>
          </HeadActions>
        }
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      {created ? <Handover result={created} onDone={() => setCreated(null)} /> : null}

      {open ? (
        <Card className="mt-5 p-5">
          <div className="grid grid-cols-3 gap-3">
            <label className={label}>
              FULL NAME
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Thabo Nkosi"
                className={field}
              />
            </label>
            <label className={label}>
              EMAIL
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="thabo@example.com"
                className={field}
              />
            </label>
            <label className={label}>
              PHONE
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Optional"
                className={field}
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => void add()} disabled={busy || !form.email.trim()}>
              {busy ? 'Registering…' : 'Register guard'}
            </Button>
            {/* Worth saying before the click, not after: this makes a real
                account, and the name here is what residents see as "on duty". */}
            <span className="text-[12px] text-muted">
              This creates a sign-in for the guard app. Their name is shown to residents when they
              start a shift.
            </span>
          </div>
        </Card>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Stat label="ACTIVE" value={active.length} />
        <Stat label="REMOVED" value={rows.length - active.length} />
      </div>

      {/* On duty now. The same current_shift the resident app reads, so the
          dashboard and the residents' phones cannot disagree about the gate. */}
      <Card className="mt-4 flex items-center gap-3.5 p-4">
        {shift ? (
          <>
            <Avatar name={shift.guard_name} className="h-11 w-11 rounded-[16px] text-[13px]" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-extrabold">{shift.guard_name}</div>
              <div className="mt-0.5 text-[12px] text-muted">
                On the gate for {heldFor(shift.started_at)}
              </div>
            </div>
            <Chip tone="good">On duty</Chip>
          </>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-extrabold">Nobody is on duty</div>
              <div className="mt-0.5 text-[12px] text-muted">
                A guard holds the gate by starting a shift in the guard app. Codes still verify —
                the gate is unmanned, not closed.
              </div>
            </div>
            <Chip>Unmanned</Chip>
          </>
        )}
      </Card>

      <Card className="mt-4">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>No guards yet. Register one to put somebody on the gate.</Empty>
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

      {/* Explanatory, not decorative: the design shows posts and a handover
          timeline. Shifts ARE recorded now (guard_shifts), but gates are not —
          a guard belongs to an estate rather than to a post — so saying so
          beats rendering plausible-looking assignments. */}
      <Card className="mt-4 p-4">
        <p className="text-[12.5px] leading-[19px] text-muted">
          Shifts are recorded, including handovers when one guard takes the gate from another. Gate
          assignments are not — the schema has no gates table, so a guard belongs to an estate
          rather than to a post. Add gates and this page can show who holds which one.
        </p>
      </Card>
    </>
  );
}
