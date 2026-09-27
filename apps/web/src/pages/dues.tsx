import { formatMoney } from '@estate/core';
import { useCallback, useEffect, useState } from 'react';

import { SettlementCard } from '../components/settlement-card';
import { Toast } from '../components/toast';
import { Button, Card, Chip, Empty, HeadActions, PageHead, Stat } from '../components/ui';
import {
  getDuesConfig,
  listDuesCharges,
  raiseCurrentDues,
  remindDuesCharge,
  setDuesConfig,
  setDuesEnforcement,
  waiveDuesCharge,
  type AdminDuesCharge,
  type DuesConfig,
} from '../lib/api';
import { useAuth } from '../lib/auth-context';

const COLS = 'grid grid-cols-[110px_1.4fr_120px_110px_120px_90px] gap-4';

const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

const MODE_COPY: Record<DuesConfig['dues_billing_mode'], string> = {
  none: 'Not collecting dues through the app',
  per_house: 'One charge per house — the landlord or any resident can settle it',
  per_resident: 'One charge per resident',
};

export function Dues() {
  const { activeEstateId, activeEstate } = useAuth();
  const [config, setConfig] = useState<DuesConfig | null>(null);
  const [rows, setRows] = useState<AdminDuesCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basis, setBasis] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  // Whether the estate has somewhere for the money to land. Billing cannot be
  // switched on without it, so the control below is disabled rather than
  // letting the admin press Save and collect a constraint error.
  const [settled, setSettled] = useState(false);
  // Kept in MAJOR units in the form and converted on save. An admin types
  // 25000, not 2500000 -- and money is stored as integer minor units precisely
  // so the conversion happens once, here, rather than everywhere.
  const [draft, setDraft] = useState<{
    mode: DuesConfig['dues_billing_mode'];
    amount: string;
    currency: string;
    grace: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    try {
      const [c, r] = await Promise.all([
        getDuesConfig(activeEstateId),
        listDuesCharges(activeEstateId),
      ]);
      setConfig(c);
      setRows(r);
      setBasis(c.dues_enforcement_basis ?? '');
      setDraft({
        mode: c.dues_billing_mode,
        amount: c.dues_amount_minor ? String(c.dues_amount_minor / 100) : '',
        currency: c.dues_currency ?? 'NGN',
        grace: String(c.dues_grace_days),
      });
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

  const toggleEnforcement = async (on: boolean) => {
    if (!activeEstateId) return;
    try {
      await setDuesEnforcement(activeEstateId, on, basis);
      await load();
      setNotice(
        on
          ? 'Enforcement on — residents with overdue dues cannot generate new codes.'
          : 'Enforcement off — dues are still billed, but nobody is restricted.',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveConfig = async () => {
    if (!activeEstateId || !draft) return;
    try {
      const minor = draft.mode === 'none' ? null : Math.round(Number(draft.amount) * 100);
      await setDuesConfig(
        activeEstateId,
        draft.mode,
        minor,
        draft.mode === 'none' ? null : draft.currency,
        Number(draft.grace),
      );
      // Raise this month straight away. An estate configured on the 8th would
      // otherwise show an empty ledger until the 1st, which reads as broken on
      // the very screen the admin just used.
      // How many charges this raised is the honest confirmation. "Saved" alone
      // was the old behaviour and it said nothing at all -- the admin pressed
      // Save, the page did not visibly change, and there was no way to tell a
      // successful save from a silently swallowed error.
      let raised = 0;
      if (draft.mode !== 'none') raised = await raiseCurrentDues(activeEstateId);
      await load();
      setNotice(
        draft.mode === 'none'
          ? 'Saved — this estate no longer bills dues through the app.'
          : raised > 0
            ? `Saved. ${raised} ${raised === 1 ? 'charge' : 'charges'} raised for this month.`
            : 'Saved. This month was already billed, so no new charges were raised.',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const [reminding, setReminding] = useState<string | null>(null);

  const remind = async (charge: AdminDuesCharge) => {
    setReminding(charge.id);
    setNotice(null);
    try {
      const n = await remindDuesCharge(charge.id);
      // The honest number, not "Sent". A house with no landlord on record and
      // no residents linked yet reminds nobody, and saying otherwise would let
      // an admin believe a bill had been chased when it had not.
      setNotice(
        n === 0
          ? 'Nobody to remind — no landlord email or resident account is on record for this charge.'
          : `Reminder sent to ${n} ${n === 1 ? 'person' : 'people'}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReminding(null);
    }
  };

  const waive = async (charge: AdminDuesCharge) => {
    const reason = window.prompt(
      `Waive ${formatMoney(charge.amount_minor, charge.currency)} for ${monthLabel(charge.period)}?\n\nRecord why — it stays on the charge.`,
    );
    if (!reason?.trim()) return;
    try {
      await waiveDuesCharge(charge.id, reason.trim());
      await load();
      setNotice(`Waived ${formatMoney(charge.amount_minor, charge.currency)} for ${monthLabel(charge.period)}.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const open = rows.filter((r) => r.status === 'open');
  const overdue = open.filter((r) => new Date(r.due_on) < new Date());
  const owed = open.reduce((n, r) => n + r.amount_minor, 0);
  const currency = rows[0]?.currency ?? config?.dues_currency ?? 'NGN';
  const enforcing = Boolean(config?.dues_enforcement_authorised_at);

  return (
    <>
      <PageHead
        title="Dues"
        blurb="Monthly estate dues, who owes what, and whether unpaid dues pause a resident's ability to generate visitor codes."
        right={<HeadActions estate={activeEstate?.estate_name ?? '—'} />}
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      {/* A viewport-fixed toast, NOT a block at the top of the page. The
          Remind buttons sit at the bottom of the charges table, and a
          confirmation rendered up here was simply never seen -- so the admin
          pressed again, sending a second email. */}
      <Toast message={notice} onDone={() => setNotice(null)} />

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="OUTSTANDING" value={formatMoney(owed, currency)} />
        <Stat label="OVERDUE CHARGES" value={overdue.length} tone={overdue.length ? 'bad' : undefined} />
        <Stat label="CHARGES RAISED" value={rows.length} />
      </div>

      {/*
        Above the billing settings, deliberately. An estate cannot switch dues
        on without a payout account -- the database refuses outright -- so the
        account has to be the first thing on the page, not a detail further
        down that the admin meets as an unexplained error at the Save button.
      */}
      {activeEstateId ? (
        <SettlementCard
          estateId={activeEstateId}
          onChange={(s) => setSettled(Boolean(s?.account_mask))}
        />
      ) : null}

      <Card className="mt-6 p-5">
        <div className="text-[10.5px] font-extrabold tracking-label text-muted">
          WHO PAYS THE DUES
        </div>
        <p className="mt-2 max-w-prose text-[12.5px] leading-[19px] text-muted">
          This decides who is billed and, in the app, what a resident is told when dues are
          overdue. Bill the house and a tenant is shown their landlord&apos;s contact details to
          chase; bill the resident and they are shown a button to pay.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-muted">Billed to</span>
            <select
              value={draft?.mode ?? 'none'}
              onChange={(e) =>
                setDraft((d) =>
                  d ? { ...d, mode: e.target.value as DuesConfig['dues_billing_mode'] } : d,
                )
              }
              className="h-11 rounded-[14px] bg-field px-3 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-lime"
            >
              <option value="none">Not collecting dues</option>
              <option value="per_house">The landlord / owner of each house</option>
              <option value="per_resident">Each resident</option>
            </select>
          </label>

          {draft?.mode !== 'none' ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-muted">Currency</span>
                <select
                  value={draft?.currency ?? 'NGN'}
                  onChange={(e) => setDraft((d) => (d ? { ...d, currency: e.target.value } : d))}
                  className="h-11 rounded-[14px] bg-field px-3 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-lime"
                >
                  <option value="NGN">NGN</option>
                  <option value="ZAR">ZAR</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-muted">Amount a month</span>
                <input
                  value={draft?.amount ?? ''}
                  onChange={(e) => setDraft((d) => (d ? { ...d, amount: e.target.value } : d))}
                  inputMode="decimal"
                  placeholder="25000"
                  className="h-11 w-36 rounded-[14px] bg-field px-4 text-[13px] outline-none focus:ring-2 focus:ring-lime"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-muted">Days to pay</span>
                <input
                  value={draft?.grace ?? '7'}
                  onChange={(e) => setDraft((d) => (d ? { ...d, grace: e.target.value } : d))}
                  inputMode="numeric"
                  className="h-11 w-24 rounded-[14px] bg-field px-4 text-[13px] outline-none focus:ring-2 focus:ring-lime"
                />
              </label>
            </>
          ) : null}

          <Button
            onClick={() => void saveConfig()}
            disabled={
              !draft ||
              (draft.mode !== 'none' &&
                (!settled || !Number(draft.amount) || Number(draft.amount) <= 0))
            }
          >
            Save
          </Button>
        </div>

        {!settled && draft?.mode !== 'none' ? (
          <div className="mt-3 text-[12.5px] font-semibold text-muted">
            Add the estate&apos;s bank account above before you start billing.
          </div>
        ) : null}

        {config ? (
          <div className="mt-3 text-[12.5px] text-muted">
            Now: {MODE_COPY[config.dues_billing_mode]}
            {config.dues_amount_minor
              ? ` · ${formatMoney(config.dues_amount_minor, config.dues_currency ?? 'NGN')} a month, due ${config.dues_grace_days} days after the 1st`
              : ''}
          </div>
        ) : null}
      </Card>

      {/*
        Enforcement is its own decision, presented as its own decision.
        Configuring an amount is administrative; withholding a service over
        arrears is a legal act the estate answers for. South Africa's CSOS
        classifies a rule denying access for unpaid levies as undesirable and
        will refuse to register it, so the default here is off and turning it on
        asks what authorises it.
      */}
      <Card className="mt-4 p-5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-extrabold tracking-label text-muted">
              PAUSE CODES WHEN DUES ARE OVERDUE
            </div>
            <div className="mt-2 text-[14px] font-bold">
              {enforcing ? 'On' : 'Off — dues are billed, nobody is restricted'}
            </div>
            <p className="mt-2 max-w-prose text-[12.5px] leading-[19px] text-muted">
              <strong className="text-ink">This applies automatically.</strong> Once on, any
              resident whose dues go overdue is paused as soon as the grace period ends, and
              unpaused the moment they pay — there is nothing to switch on per resident. Their own
              access to the estate is never affected, and codes they have already issued keep
              working until they expire.
            </p>
            <p className="mt-2 max-w-prose text-[12.5px] leading-[19px] text-muted">
              Withholding a service over unpaid levies is a decision your scheme&apos;s rules have
              to support. Record what authorises it — a resident or an adjudicator may ask.
            </p>
            <input
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              placeholder="e.g. MOI clause 11.4, or AGM resolution of 14 March 2026"
              className="mt-3 h-11 w-full rounded-[14px] bg-field px-4 text-[13px] outline-none focus:ring-2 focus:ring-lime"
            />
            {enforcing && config?.dues_enforcement_authorised_at ? (
              <div className="mt-2 text-[11.5px] text-muted">
                Recorded {new Date(config.dues_enforcement_authorised_at).toLocaleDateString()}
              </div>
            ) : null}
          </div>
          <div className="flex-none">
            {enforcing ? (
              <Button variant="quiet" onClick={() => void toggleEnforcement(false)}>
                Turn off
              </Button>
            ) : (
              <Button onClick={() => void toggleEnforcement(true)} disabled={!basis.trim()}>
                Turn on
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="mt-6 py-4">
        <div className={`${COLS} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>PERIOD</span>
          <span>WHO</span>
          <span>AMOUNT</span>
          <span>DUE</span>
          <span>STATUS</span>
          <span></span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>
            No charges yet. They are raised automatically on the 1st of each month once billing is
            configured.
          </Empty>
        ) : (
          rows.map((r) => {
            const isOverdue = r.status === 'open' && new Date(r.due_on) < new Date();
            return (
              <div key={r.id} className={`${COLS} items-center border-t border-hair px-4 py-3`}>
                <div className="text-[12.5px] font-bold text-muted">{monthLabel(r.period)}</div>
                <div className="truncate text-[13px]">
                  {r.house_number ? `House ${r.house_number}` : (r.resident_name ?? '—')}
                </div>
                <div className="text-[12.5px] font-bold">
                  {formatMoney(r.amount_minor, r.currency)}
                </div>
                <div className="text-[12.5px] text-muted">
                  {new Date(`${r.due_on}T00:00:00`).toLocaleDateString()}
                </div>
                <div>
                  {r.status === 'paid' ? (
                    <Chip tone="good">Paid</Chip>
                  ) : r.status === 'waived' ? (
                    <Chip>Waived</Chip>
                  ) : isOverdue ? (
                    <Chip tone="bad">Overdue</Chip>
                  ) : (
                    <Chip>Open</Chip>
                  )}
                </div>
                <div className="flex items-center justify-end gap-3 text-right">
                  {r.status === 'open' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void remind(r)}
                        disabled={reminding === r.id}
                        className="text-[12px] font-bold text-muted underline hover:text-ink disabled:opacity-50"
                      >
                        {reminding === r.id ? 'Sending…' : 'Remind'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void waive(r)}
                        className="text-[12px] font-bold text-muted underline hover:text-ink"
                      >
                        Waive
                      </button>
                    </>
                  ) : r.waive_reason ? (
                    <span className="text-[11.5px] text-muted" title={r.waive_reason}>
                      why?
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </Card>
    </>
  );
}
