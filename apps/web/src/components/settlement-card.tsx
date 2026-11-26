import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearEstateSettlement,
  getEstateSettlement,
  listSettlementBanks,
  resolveSettlementAccount,
  saveEstateSettlement,
  type EstateSettlement,
} from '../lib/api';
import { Button, Card, Chip } from './ui';

/**
 * The estate's own bank account, and the gate in front of billing anybody.
 *
 * Dues are paid straight into this account by Flutterwave's split — the money
 * never passes through us. That is not a convenience: holding an estate's
 * levies would make us an unlicensed fund-holder in Nigeria and a Third Party
 * Payment Provider in South Africa, and CSOS Practice Directive 13.3 allows a
 * body corporate's money in exactly two places, neither of which is a
 * platform's balance.
 *
 * So this card sits ABOVE the billing settings and says so plainly. An estate
 * that has not set it cannot switch dues on at all — the database refuses —
 * and an admin who meets that refusal at the Save button, with no explanation,
 * reads it as the product being broken.
 *
 * ─── The two-step confirm ───────────────────────────────────────────────────
 *
 * Check, then save. The admin types an account number, sees the name the BANK
 * has against it, and only then commits. Saving first and showing the name
 * afterwards is the version where a transposed digit is discovered a month
 * later by the treasurer who never got the money.
 *
 * South Africa has no account-name lookup on the rail, so there is nothing to
 * check against and the card says exactly that rather than implying a
 * verification that did not happen.
 */
export function SettlementCard({
  estateId,
  onChange,
}: {
  estateId: string;
  /** Called after every load and every change, so the page above can gate on it. */
  onChange?: (settlement: EstateSettlement | null) => void;
}) {
  const [current, setCurrent] = useState<EstateSettlement | null>(null);
  // Whether the server is holding Flutterwave SANDBOX keys. Surfaced because
  // in that mode no real bank account can be added at all -- the lookup and the
  // subaccount call both refuse one -- and an admin has no way to tell that
  // apart from having mistyped something.
  const [testMode, setTestMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [country, setCountry] = useState<'NG' | 'ZA'>('NG');
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([]);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [typedName, setTypedName] = useState('');
  // The result of the check. `null` means not checked yet, which is not the
  // same as checked-and-failed, so Save stays disabled until it is set.
  const [checked, setChecked] = useState<{ name: string | null; verified: boolean } | null>(null);

  // Held in a ref so a caller passing an inline arrow does not re-run load on
  // every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { settlement: s, testMode: t } = await getEstateSettlement(estateId);
      setCurrent(s);
      setTestMode(t);
      if (s?.country) setCountry(s.country);
      onChangeRef.current?.(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [estateId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editing) return;
    setBanks([]);
    setBankCode('');
    listSettlementBanks(country).then(setBanks).catch((e) => setError((e as Error).message));
  }, [country, editing]);

  // Any edit to the account invalidates a previous check. Without this the
  // admin could check one number, change a digit, and save the name that was
  // confirmed for the old one.
  const invalidate = () => setChecked(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await resolveSettlementAccount(estateId, country, bankCode, accountNumber.trim());
      setChecked({ name: r.account_name, verified: r.verified });
    } catch (e) {
      setChecked(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveEstateSettlement({
        estateId,
        country,
        bankCode,
        bankName: banks.find((b) => b.code === bankCode)?.name ?? '',
        accountNumber: accountNumber.trim(),
        accountName: checked?.name ?? typedName.trim(),
      });
      setEditing(false);
      setChecked(null);
      setAccountNumber('');
      setTypedName('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await clearEstateSettlement(estateId);
      await load();
    } catch (e) {
      setError(
        (e as Error).message.includes('turn_off_dues_first')
          ? 'Stop collecting dues first — set “Billed to” to “Not collecting dues”, then remove the account.'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) return null;

  const configured = Boolean(current?.account_mask);
  // ZA cannot be verified, so a typed name is required there and only there.
  const needsTypedName = checked !== null && !checked.verified;
  const canSave =
    Boolean(bankCode) &&
    accountNumber.trim().length >= 6 &&
    checked !== null &&
    (checked.verified || typedName.trim().length > 2);

  return (
    <Card className={`mt-6 p-5 ${configured ? '' : 'ring-2 ring-lime'}`}>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-extrabold tracking-label text-muted">
            WHERE THE DUES ARE PAID
          </div>
          <p className="mt-2 max-w-prose text-[12.5px] leading-[19px] text-muted">
            Residents pay straight into this account. The money goes from their card to your
            bank — it never passes through us, and there is nothing for us to release or
            delay.
          </p>
        </div>
        {configured && !editing ? (
          <Chip tone={current?.account_verified ? 'good' : 'plain'}>
            {current?.account_verified ? 'Confirmed by the bank' : 'Not verified'}
          </Chip>
        ) : null}
      </div>

      {testMode ? (
        <div className="mt-4 rounded-[14px] bg-field px-4 py-3">
          <div className="text-[11px] font-extrabold tracking-label text-muted">
            TEST MODE
          </div>
          <p className="mt-1 max-w-prose text-[12.5px] leading-[19px] text-muted">
            Payments are running on Flutterwave test keys. A real bank account cannot be added
            yet — the bank lookup only knows Flutterwave&apos;s sandbox, so any real account is
            rejected no matter how correct it is. Use Access Bank / 0690000032 to try the flow.
            Nothing here moves real money until the live keys are deployed.
          </p>
        </div>
      ) : null}

      {configured && !editing ? (
        <div className="mt-4">
          <div className="text-[14px] font-extrabold">{current?.account_name}</div>
          <div className="mt-1 text-[12.5px] text-muted">
            {current?.bank_name ?? current?.bank_code} · {current?.account_mask}
          </div>
          {!current?.account_verified ? (
            <p className="mt-2 max-w-prose text-[12px] leading-[18px] text-muted">
              South African banks do not offer an account-name check, so we could not confirm
              this with the bank. Please make sure it is exactly right — a wrong number here
              sends the estate&apos;s money somewhere else.
            </p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button variant="quiet" onClick={() => setEditing(true)}>
              Change account
            </Button>
            <Button variant="quiet" onClick={() => void remove()} disabled={busy}>
              Remove
            </Button>
          </div>
        </div>
      ) : null}

      {!configured && !editing ? (
        <div className="mt-4">
          <p className="max-w-prose text-[12.5px] font-semibold leading-[19px]">
            You need to add the estate&apos;s bank account before you can start collecting dues.
          </p>
          <Button className="mt-3" onClick={() => setEditing(true)}>
            Add the estate&apos;s account
          </Button>
        </div>
      ) : null}

      {editing ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-muted">Country</span>
              <select
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value as 'NG' | 'ZA');
                  invalidate();
                }}
                className="h-11 rounded-[14px] bg-field px-3 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-lime"
              >
                <option value="NG">Nigeria</option>
                <option value="ZA">South Africa</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-muted">Bank</span>
              <select
                value={bankCode}
                onChange={(e) => {
                  setBankCode(e.target.value);
                  invalidate();
                }}
                disabled={banks.length === 0}
                className="h-11 w-64 rounded-[14px] bg-field px-3 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-lime"
              >
                <option value="">{banks.length ? 'Choose a bank' : 'Loading banks…'}</option>
                {banks.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-bold text-muted">Account number</span>
              <input
                value={accountNumber}
                onChange={(e) => {
                  setAccountNumber(e.target.value.replace(/[^\d]/g, ''));
                  invalidate();
                }}
                inputMode="numeric"
                placeholder="0690000032"
                className="h-11 w-48 rounded-[14px] bg-field px-4 text-[13px] outline-none focus:ring-2 focus:ring-lime"
              />
            </label>

            <Button
              variant="quiet"
              onClick={() => void check()}
              disabled={busy || !bankCode || accountNumber.trim().length < 6}
            >
              {busy ? 'Checking…' : 'Check account'}
            </Button>
          </div>

          {checked?.verified ? (
            <div className="mt-4 rounded-[14px] bg-lime-soft px-4 py-3">
              <div className="text-[11px] font-bold text-lime-ink">THE BANK SAYS THIS ACCOUNT IS</div>
              <div className="mt-1 text-[15px] font-extrabold text-lime-ink">{checked.name}</div>
              <p className="mt-1 text-[12px] text-lime-ink">
                If that is not the estate&apos;s account, do not save it.
              </p>
            </div>
          ) : null}

          {needsTypedName ? (
            <div className="mt-4 rounded-[14px] bg-field px-4 py-3">
              <p className="max-w-prose text-[12.5px] leading-[19px] text-muted">
                South African banks do not offer an account-name check, so we cannot confirm who
                owns this account. Type the name exactly as the bank has it, and check the number
                once more before saving.
              </p>
              <input
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Body corporate name as the bank has it"
                className="mt-3 h-11 w-full max-w-md rounded-[14px] bg-canvas px-4 text-[13px] outline-none focus:ring-2 focus:ring-lime"
              />
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button onClick={() => void save()} disabled={busy || !canSave}>
              {busy ? 'Saving…' : 'Save this account'}
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setEditing(false);
                setChecked(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-[14px] bg-coral-soft px-4 py-3 text-[12.5px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}
    </Card>
  );
}
