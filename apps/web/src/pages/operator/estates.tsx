import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Avatar, Button, Card, Chip, Empty, FilterChips, PageHead, Search,
} from '../../components/ui';
import { listOperatorEstates, onboardEstate, type OnboardResult, type OperatorEstate } from '../../lib/operator';
import { ago, count } from '../../lib/operator-format';

const COLS =
  'grid grid-cols-[minmax(0,1.5fr)_80px_90px_minmax(0,1.1fr)_110px_130px] gap-4';

const FILTERS = ['All', 'Live', 'Onboarding'] as const;
type Filter = (typeof FILTERS)[number];

const field =
  'mt-1.5 h-11 w-full rounded-[14px] bg-field px-4 text-[13px] font-normal tracking-normal text-ink outline-none focus:ring-2 focus:ring-lime';
const label = 'text-[11px] font-bold tracking-label text-muted';

/**
 * The handover panel.
 *
 * Shown once, after onboarding, and never retrievable: the password is not
 * stored anywhere in readable form — it went straight into the auth system as a
 * hash. If this is dismissed before it is written down, the fix is to reset the
 * password, not to look it up.
 */
function Handover({ result, onDone }: { result: OnboardResult; onDone: () => void }) {
  return (
    <Card className="mt-5 border-lime bg-lime-soft p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-extrabold">{result.estate_name} is live</div>
          <div className="mt-1 text-[12px] leading-[1.5] text-lime-ink">
            {result.reused_existing_account
              ? 'That email already had an account, so it keeps its existing password. They will find the new estate waiting when they sign in.'
              : 'Hand these to the estate admin. The password is shown once and is not recoverable — it was hashed on the way in.'}
          </div>
        </div>
        <Button variant="quiet" onClick={onDone}>
          Done
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-[14px] bg-card px-4 py-3">
          <div className={label}>ADMIN EMAIL</div>
          <div className="mt-1 truncate text-[13px] font-bold">{result.admin_email}</div>
        </div>
        <div className="rounded-[14px] bg-card px-4 py-3">
          <div className={label}>TEMPORARY PASSWORD</div>
          <div className="mt-1 text-[13px] font-extrabold tracking-code">
            {result.password ?? 'Unchanged — existing account'}
          </div>
        </div>
        <div className="rounded-[14px] bg-card px-4 py-3">
          <div className={label}>ESTATE CODE</div>
          <div className="mt-1 text-[13px] font-extrabold tracking-code">{result.join_code ?? '—'}</div>
        </div>
      </div>

      <div className="mt-3 text-[11.5px] leading-[1.5] text-lime-ink">
        {result.password
          ? 'They will be asked to choose their own password the first time they sign in. Their next job is to add houses — each house gets its own code, and a resident joins with the estate code plus their house code.'
          : 'Their next job is to add houses to this estate — each house gets its own code, and a resident joins with the estate code plus their house code.'}
      </div>
    </Card>
  );
}

export function Estates() {
  const [rows, setRows] = useState<OperatorEstate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('All');

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', adminName: '', adminEmail: '' });
  const [result, setResult] = useState<OnboardResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listOperatorEstates());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!form.name.trim() || !form.adminEmail.trim()) {
      setError('An estate name and an admin email are both required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await onboardEstate({
        estate_name: form.name.trim(),
        address: form.address.trim() || undefined,
        admin_email: form.adminEmail.trim(),
        admin_name: form.adminName.trim() || undefined,
      });
      setResult(res);
      setForm({ name: '', address: '', adminName: '', adminEmail: '' });
      setOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((e) => {
      // "Live" is having an admin: without one nobody can add a house, so
      // nothing can reach the gate. It is derived, never a stored status.
      const live = e.admin_count > 0;
      if (filter === 'Live' && !live) return false;
      if (filter === 'Onboarding' && live) return false;
      if (!n) return true;
      return `${e.name} ${e.address ?? ''} ${e.admin_name ?? ''} ${e.admin_email ?? ''} ${e.join_code}`
        .toLowerCase()
        .includes(n);
    });
  }, [rows, q, filter]);

  return (
    <>
      <PageHead
        title="Estates"
        blurb="Every estate the platform serves. Onboarding one creates the estate and its first admin account in a single step — you hand over the password, they add the houses."
        right={
          <Button onClick={() => setOpen((v) => !v)} className="h-[42px] px-[22px] text-[13.5px]">
            {open ? 'Cancel' : 'Onboard an estate'}
          </Button>
        }
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      {result ? <Handover result={result} onDone={() => setResult(null)} /> : null}

      {open ? (
        <Card className="mt-5 p-5">
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              ESTATE NAME
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Sable Ridge"
                className={field}
              />
            </label>
            <label className={label}>
              ADDRESS
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Optional"
                className={field}
              />
            </label>
            <label className={label}>
              ESTATE ADMIN NAME
              <input
                value={form.adminName}
                onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                placeholder="Optional"
                className={field}
              />
            </label>
            <label className={label}>
              ESTATE ADMIN EMAIL
              <input
                type="email"
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                placeholder="admin@estate.example"
                className={field}
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? 'Onboarding…' : 'Create estate and admin'}
            </Button>
            {/* Worth saying before they press it: nothing is emailed, so the
                password has to be carried out of this screen by hand. */}
            <span className="text-[12px] text-muted">
              Creates the account immediately and shows its password once. Nothing is emailed.
            </span>
          </div>
        </Card>
      ) : null}

      <div className="mt-6 flex items-center gap-2.5">
        <Search value={q} onChange={setQ} placeholder="Search estates, admins or codes" />
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
      </div>

      <Card className="mt-3.5 py-4">
        <div className={`${COLS} px-[18px] pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>ESTATE</span>
          <span>HOUSES</span>
          <span>RESIDENTS</span>
          <span>ESTATE ADMIN</span>
          <span>VERIFIED · 30D</span>
          <span>STATE</span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : shown.length === 0 ? (
          <Empty>
            {rows.length === 0
              ? 'No estates yet. Onboard one — it creates the estate and its admin together.'
              : 'No estate matches that search.'}
          </Empty>
        ) : (
          shown.map((e) => (
            <div key={e.id} className={`${COLS} items-center border-t border-hair px-[18px] py-3.5`}>
              <div className="flex min-w-0 items-center gap-[11px]">
                <Avatar name={e.name} />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-bold">{e.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted">
                    {e.address ?? <span className="tracking-code">{e.join_code}</span>}
                  </div>
                </div>
              </div>
              <span className="text-[12.5px] text-muted">{count(e.houses)}</span>
              <span className="text-[12.5px] text-muted">{count(e.residents)}</span>
              <div className="min-w-0">
                {e.admin_email ? (
                  <>
                    <div className="truncate text-[12.5px] font-semibold">
                      {e.admin_name ?? e.admin_email}
                    </div>
                    {/* Only when it adds something. An admin onboarded without a
                        name would otherwise show the same address twice. */}
                    {e.admin_name ? (
                      <div className="mt-0.5 truncate text-[11px] text-muted">{e.admin_email}</div>
                    ) : null}
                  </>
                ) : (
                  <span className="text-[12.5px] text-muted">Not assigned</span>
                )}
              </div>
              <span className="text-[13px] font-extrabold">{count(e.verifications_30d)}</span>
              <div className="flex items-center gap-2">
                {e.admin_count === 0 ? (
                  <Chip tone="bad">No admin</Chip>
                ) : e.houses === 0 ? (
                  <Chip>No houses</Chip>
                ) : (
                  <Chip tone="good">Live</Chip>
                )}
              </div>
            </div>
          ))
        )}
      </Card>

      {rows.length > 0 ? (
        <div className="mt-4 flex items-center justify-between text-[12px] font-semibold text-muted">
          <span>
            Showing {shown.length} of {rows.length} estates · last activity{' '}
            {ago(rows.map((r) => r.last_activity).filter(Boolean).sort().at(-1) ?? null)}
          </span>
        </div>
      ) : null}
    </>
  );
}
