import { DUES_TERMS, estimateTermTotal, formatMoney, type DuesTermMonths } from '@estate/core';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Toast } from '../../components/toast';
import { Button, Card, Chip, Empty, PageHead, Stat } from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import {
  landlordDues,
  myLandlordHouses,
  startLandlordPayment,
  type LandlordCharge,
  type LandlordHouse,
} from '../../lib/landlord';

/**
 * Everything a landlord owns, and everything they owe on it.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * A landlord used to receive one emailed link per charge. That is fine for one
 * house and unusable at four: four emails, four payments, no history, and no
 * way to see what has already been settled. Owning across two estates made it
 * worse, because nothing anywhere showed both.
 *
 * ─── What is deliberately absent ────────────────────────────────────────────
 *
 * Their tenants' debts. Where a house bills its RESIDENTS, each resident owes
 * their own dues and the landlord owes nothing — so those charges are not
 * counted, not listed, and not payable from here. What the people living in a
 * property owe is between them and the estate, and a landlord is their
 * counterparty on rent, not on levies.
 *
 * The screen says so out loud rather than showing a silent zero, because a
 * zero with no explanation reads as a bug on a page about money.
 */
function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  });
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function LandlordDashboard() {
  const { session } = useAuth();
  const [houses, setHouses] = useState<LandlordHouse[]>([]);
  const [charges, setCharges] = useState<LandlordCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  // Per house: a landlord with two properties may pay one yearly and one monthly.
  const [terms, setTerms] = useState<Record<string, DuesTermMonths>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, c] = await Promise.all([myLandlordHouses(), landlordDues()]);
      setHouses(h);
      setCharges(c);
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

  const pay = async (charge: LandlordCharge, months: number) => {
    setPaying(charge.charge_id);
    setError(null);
    try {
      const link = await startLandlordPayment(charge.charge_id, months);
      // Same tab. A checkout opened in a new tab loses the payer whenever a
      // browser blocks the popup, and the return page brings them back here.
      window.location.href = link;
    } catch (e) {
      setError((e as Error).message);
      setPaying(null);
    }
  };

  const owed = houses.reduce((n, h) => n + Number(h.outstanding_minor), 0);
  const overdue = houses.reduce((n, h) => n + Number(h.overdue_minor), 0);
  const currency = houses.find((h) => h.currency)?.currency ?? 'NGN';
  // Oldest first, so a term always starts at the oldest unpaid month of its
  // house -- paying a year from a later month would leave the arrears behind.
  const open = charges
    .filter((c) => c.status === 'open')
    .sort((a, b) => a.period.localeCompare(b.period));
  const anchorOf = new Map<string, string>();
  for (const c of open) if (!anchorOf.has(c.house_id)) anchorOf.set(c.house_id, c.charge_id);
  const settled = charges.filter((c) => c.status !== 'open');

  return (
    <>
      <PageHead
        title="Your properties"
        blurb="Every house recorded against your email address, across every estate — what is owed on each, and what you have already paid."
        right={
          <div className="text-[12.5px] text-muted">
            {session?.user.email}
          </div>
        }
      />

      <Toast message={notice} onDone={() => setNotice(null)} />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="PROPERTIES" value={houses.length} />
        <Stat label="OUTSTANDING" value={formatMoney(owed, currency)} />
        <Stat
          label="OVERDUE"
          value={formatMoney(overdue, currency)}
          tone={overdue > 0 ? 'bad' : undefined}
        />
      </div>

      {loading ? (
        <Card className="mt-6 py-4">
          <Empty>Loading…</Empty>
        </Card>
      ) : houses.length === 0 ? (
        <Card className="mt-6 p-5">
          <div className="text-[10.5px] font-extrabold tracking-label text-muted">
            NOTHING RECORDED YET
          </div>
          <p className="mt-2 max-w-prose text-[13px] leading-[20px] text-muted">
            No house lists <strong className="text-ink">{session?.user.email}</strong> as its
            landlord. The estate office records who owns each house, so if this looks wrong ask
            them to check the address they have for you — it has to match this one exactly.
          </p>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3">
          {houses.map((h) => {
            const residentsPay = h.dues_payer === 'residents';
            return (
              <Card key={h.house_id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10.5px] font-extrabold tracking-label text-muted">
                      {h.estate_name.toUpperCase()}
                    </div>
                    <Link
                      to={`houses/${h.house_id}`}
                      className="mt-1 block text-[19px] font-extrabold tracking-tight hover:underline"
                    >
                      House {h.house_number} →
                    </Link>
                  </div>
                  {h.overdue_minor > 0 ? (
                    <Chip tone="bad">Overdue</Chip>
                  ) : h.outstanding_minor > 0 ? (
                    <Chip>Due</Chip>
                  ) : (
                    <Chip tone="good">Clear</Chip>
                  )}
                </div>

                <div className="mt-4 text-[13px] text-muted">
                  {h.residents} {h.residents === 1 ? 'resident' : 'residents'} living here
                </div>

                {/* Said explicitly rather than shown as a bare zero. On a page
                    about money, an unexplained ₦0 reads as a fault. */}
                {residentsPay ? (
                  <p className="mt-3 max-w-prose text-[12.5px] leading-[19px] text-muted">
                    This estate bills each resident directly
                    {h.dues_amount_minor
                      ? ` (${formatMoney(h.dues_amount_minor, h.currency ?? currency)} each)`
                      : ''}
                    , so there is nothing for you to pay here.
                  </p>
                ) : h.dues_payer === 'landlord' ? (
                  <div className="mt-3">
                    <div className="text-[10.5px] font-extrabold tracking-label text-muted">
                      YOU OWE
                    </div>
                    <div className="mt-1 text-[24px] font-extrabold tracking-tight">
                      {formatMoney(h.outstanding_minor, h.currency ?? currency)}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-[12.5px] leading-[19px] text-muted">
                    This estate does not collect dues through the app.
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {open.length > 0 ? (
        <>
          <h2 className="mt-8 text-[15px] font-extrabold tracking-tight">To pay</h2>
          <Card className="mt-3 py-2">
            {open.map((c) => {
              const isAnchor = anchorOf.get(c.house_id) === c.charge_id;
              const months = isAnchor ? (terms[c.house_id] ?? 1) : 1;
              const house = houses.find((h) => h.house_id === c.house_id);
              const total = months === 1
                ? c.amount_minor
                : estimateTermTotal(
                    open.filter((o) => o.house_id === c.house_id).map((o) => o.amount_minor),
                    house?.dues_amount_minor ?? null,
                    months,
                  );
              return (
              <div
                key={c.charge_id}
                className="flex items-center gap-4 border-b border-hair px-5 py-3.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-extrabold">
                    House {c.house_number}
                    <span className="font-semibold text-muted"> · {c.estate_name}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {monthLabel(c.period)} · due {dayLabel(c.due_on)}
                  </div>
                </div>
                {c.is_overdue ? <Chip tone="bad">Overdue</Chip> : null}
                {isAnchor ? (
                  <select
                    aria-label={`How far ahead to pay for house ${c.house_number}`}
                    value={months}
                    onChange={(e) =>
                      setTerms((t) => ({ ...t, [c.house_id]: Number(e.target.value) as DuesTermMonths }))
                    }
                    className="h-9 rounded-chip bg-field px-3 text-[12.5px] font-bold outline-none focus:ring-2 focus:ring-lime"
                  >
                    {DUES_TERMS.map((t) => (
                      <option key={t.months} value={t.months}>{t.label}</option>
                    ))}
                  </select>
                ) : null}
                <Button onClick={() => void pay(c, months)} disabled={paying !== null}>
                  {paying === c.charge_id
                    ? 'Opening…'
                    : months === 1
                      ? `Pay ${formatMoney(c.amount_minor, c.currency)}`
                      : `Pay ${months} months${total === null ? '' : ` · ${formatMoney(total, c.currency)}`}`}
                </Button>
              </div>
              );
            })}
          </Card>
        </>
      ) : null}

      <h2 className="mt-8 text-[15px] font-extrabold tracking-tight">Payment history</h2>
      <Card className="mt-3 py-2">
        {settled.length === 0 ? (
          <Empty>Nothing settled yet. Paid and waived months appear here.</Empty>
        ) : (
          settled.map((c) => (
            <div
              key={c.charge_id}
              className="flex items-center gap-4 border-b border-hair px-5 py-3.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-extrabold">
                  House {c.house_number}
                  <span className="font-semibold text-muted"> · {c.estate_name}</span>
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {monthLabel(c.period)}
                  {c.paid_at ? ` · paid ${dayLabel(c.paid_at.slice(0, 10))}` : ''}
                  {c.waive_reason ? ` · ${c.waive_reason}` : ''}
                </div>
              </div>
              <div className="text-[13px] font-extrabold">
                {formatMoney(c.amount_minor, c.currency)}
              </div>
              <Chip tone={c.status === 'paid' ? 'good' : 'plain'}>
                {c.status === 'paid' ? 'Paid' : 'Waived'}
              </Chip>
            </div>
          ))
        )}
      </Card>

      <p className="mt-6 max-w-prose text-[12px] leading-[18px] text-muted">
        Payments are handled by Flutterwave and settle directly into the estate&apos;s own bank
        account. We never see or store your card details.
      </p>
    </>
  );
}
