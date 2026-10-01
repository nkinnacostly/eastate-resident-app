import { DUES_TERMS, estimateTermTotal, formatMoney, type DuesTermMonths } from '@estate/core';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, Text, View } from 'react-native';

import { LandlordCard } from '@/components/landlord-card';
import { Card, Chip, Eyebrow, PrimaryButton, Screen, SecondaryButton } from '@/components/ui';
import { startDuesPayment, type DuesCharge } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDuesStatus } from '@/lib/dues-status';

/**
 * Everything a resident owes, has paid, and will owe next.
 *
 * ─── Why this is a TAB ──────────────────────────────────────────────────────
 *
 * It used to be reachable only by being refused a visitor code, which framed
 * money owed as an error state — something you discover by failing. Dues are
 * an ordinary, recurring part of living somewhere. A resident should be able
 * to check what they owe, pay it, and see what they have already paid, without
 * first doing something that gets turned down.
 *
 * ─── Why the header comes from the server ───────────────────────────────────
 *
 * An estate with dues configured but no charges raised yet returns an empty
 * LIST. A screen built only from that list would show "nothing outstanding" to
 * someone who owes from the 1st — the most misleading thing it could say. The
 * summary always returns a row, so the terms are stated whether or not a
 * charge exists, and the next due date is computed where the grace period
 * lives rather than re-derived here.
 */
function periodLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** "8 Oct 2026" — a due date is a day, not a month. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Dues() {
  const { activeEstateId, memberships } = useAuth();
  const dues = useDuesStatus(activeEstateId);
  const [paying, setPaying] = useState<string | null>(null);
  const [term, setTerm] = useState<DuesTermMonths>(1);

  const { summary, outstanding, overdue, loading } = dues;
  const estateName =
    memberships.find((m) => m.estate_id === activeEstateId)?.estate_name ?? 'Your estate';

  // WHO PAYS decides the whole screen. In a house-billed estate the resident
  // cannot settle a bill they were never given, so leading with a Pay button
  // would be telling them to do something that is not theirs to do.
  const landlordPays = summary?.billing_mode === 'per_house';
  const blocking = overdue[0] ?? null;
  const currency = dues.currency;

  const pay = async (charge: DuesCharge, months: number) => {
    setPaying(charge.charge_id);
    try {
      const link = await startDuesPayment(charge.charge_id, months);
      // An in-app browser, not a redirect out of the app. The resident comes
      // back here when it closes, and this screen re-reads on focus -- so the
      // list is correct whether the webhook or the return landed first.
      await openBrowserAsync(link);
      await dues.refresh();
    } catch (e) {
      Alert.alert('Could not start the payment', (e as Error).message);
    } finally {
      setPaying(null);
    }
  };

  /**
   * Hand the bill to whoever actually pays it.
   *
   * The link needs no account, which is the point: `houses` carries a landlord
   * as name/phone/email and says outright they never sign in. Shown to the
   * tenant as well, because in a house-billed estate the tenant often settles
   * and squares up privately.
   */
  const shareLink = async (charge: DuesCharge) => {
    const url = `https://myestateaccess.com/dues/pay?t=${encodeURIComponent(charge.pay_token)}`;
    await Share.share({
      message:
        `Estate dues for ${periodLabel(charge.period)}: ` +
        `${formatMoney(charge.amount_minor, charge.currency)}.\n\n` +
        `Pay here — no account needed:\n${url}`,
    });
  };

  const settled = outstanding.length === 0;
  // A term is paid from the OLDEST open month forward, so arrears are always
  // covered first -- paying a year from next month while this month is unpaid
  // would leave the debt that pauses codes exactly where it was.
  const oldestFirst = [...outstanding].sort((a, b) => a.period.localeCompare(b.period));
  const anchor = oldestFirst[0] ?? null;
  const termTotal = estimateTermTotal(
    oldestFirst.map((r) => r.amount_minor),
    summary?.monthly_minor ?? null,
    term,
  );
  // Paid and waived, newest first. Kept apart from what is due: mixing them
  // makes a resident hunt for the one line that needs action.
  const history = dues.settled;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-28"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={dues.refresh} />}
      >
        <Text className="mt-3 font-jk-xb text-display tracking-tight text-ink">Dues</Text>

        {summary?.billing_mode === 'none' ? (
          <Card className="mt-4 p-5">
            <Text className="font-jk text-sub leading-[20px] text-muted">
              {estateName} does not collect dues through this app. Nothing to pay here.
            </Text>
          </Card>
        ) : (
          <>
            {/* ── What is owed right now ── */}
            <Card className={`mt-4 p-5 ${dues.blocked ? 'bg-ink' : ''}`}>
              <Eyebrow className={dues.blocked ? 'text-lime' : 'text-muted'}>
                {dues.blocked ? 'CODES PAUSED' : settled ? 'UP TO DATE' : 'OUTSTANDING'}
              </Eyebrow>
              <Text
                className={`mt-1.5 font-jk-xb text-[32px] tracking-tight ${
                  dues.blocked ? 'text-canvas' : 'text-ink'
                }`}
              >
                {formatMoney(dues.totalOwedMinor, currency)}
              </Text>

              {dues.blocked ? (
                <Text className="mt-2 font-jk text-sub leading-[20px] text-canvas/75">
                  {landlordPays
                    ? 'Your house has unpaid dues, so new visitor codes are paused. These are the owner’s to pay, not yours.'
                    : 'New visitor codes are paused until this is settled.'}{' '}
                  Your own access to the estate is unaffected, and codes you have already shared
                  still work.
                </Text>
              ) : settled ? (
                <Text className="mt-2 font-jk text-sub leading-[20px] text-muted">
                  Nothing to pay. {summary?.paid_count ? `${summary.paid_count} payment${summary.paid_count === 1 ? '' : 's'} on record.` : ''}
                </Text>
              ) : (
                <Text className="mt-2 font-jk text-sub leading-[20px] text-muted">
                  {landlordPays
                    ? 'Billed to your house rather than to you. Anyone can settle it.'
                    : 'Due now. Codes are not paused for this yet.'}
                </Text>
              )}
            </Card>

            {/* ── When the next bill lands ──
                Shown even when nothing is owed, which is the point of a tab
                you can visit rather than get sent to: "what is coming" is a
                question people ask before it arrives. */}
            {summary?.next_period && summary.monthly_minor ? (
              <Card className="mt-3 p-5">
                <Eyebrow className="text-muted">NEXT PAYMENT</Eyebrow>
                <View className="mt-1.5 flex-row items-baseline justify-between">
                  <Text className="font-jk-xb text-[22px] tracking-tight text-ink">
                    {formatMoney(summary.monthly_minor, summary.currency ?? currency)}
                  </Text>
                  <Text className="font-jk-b text-sub text-muted">
                    {periodLabel(summary.next_period)}
                  </Text>
                </View>
                <Text className="mt-2 font-jk text-micro leading-[17px] text-muted">
                  Due {dayLabel(summary.next_due_on ?? summary.next_period)} — that is{' '}
                  {summary.grace_days} day{summary.grace_days === 1 ? '' : 's'} after the 1st.
                  {settled ? ' Once it is billed you can pay 3, 6 or 12 months at once.' : ''}
                </Text>
              </Card>
            ) : null}

            {/* The action that resolves it, when it is not paying. */}
            {blocking && landlordPays ? (
              <LandlordCard
                name={blocking.landlord_name}
                phone={blocking.landlord_phone}
                email={blocking.landlord_email}
                estateName={estateName}
              />
            ) : null}

            {/* ── To pay ── */}
            {outstanding.length > 0 ? (
              <>
                <Text className="mt-7 font-jk-b text-title text-ink">To pay</Text>
                <TermPicker value={term} onChange={setTerm} />
                {oldestFirst.map((r) => {
                  // The term rides on the oldest month only; any later open
                  // month is inside the term anyway, or payable on its own.
                  const months = r === anchor ? term : 1;
                  return (
                    <ChargeRow
                      key={r.charge_id}
                      charge={r}
                      paying={paying}
                      months={months}
                      termTotal={r === anchor ? termTotal : r.amount_minor}
                      onPay={() => void pay(r, months)}
                      onShare={() => void shareLink(r)}
                    />
                  );
                })}
              </>
            ) : null}

            {/* ── History ──
                Separate from what is due, so a resident never has to hunt
                through settled months for the one line that needs action. */}
            <Text className="mt-7 font-jk-b text-title text-ink">History</Text>
            {history.length === 0 ? (
              <Card className="mt-3 p-4">
                <Text className="font-jk text-sub text-muted">
                  Nothing settled yet. Paid and waived months appear here.
                </Text>
              </Card>
            ) : (
              history.map((r: DuesCharge) => (
                <ChargeRow key={r.charge_id} charge={r} paying={null} />
              ))
            )}
          </>
        )}

        {loading && !summary ? <ActivityIndicator className="mt-8" /> : null}

        <Text className="mt-6 px-1 font-jk text-micro leading-[17px] text-muted">
          Payments are handled by Flutterwave. We never see or store your card details.
        </Text>
      </ScrollView>
    </Screen>
  );
}

/**
 * How far ahead to pay. Dues stay monthly; this only decides how many months
 * one checkout settles.
 */
function TermPicker({
  value,
  onChange,
}: {
  value: DuesTermMonths;
  onChange: (m: DuesTermMonths) => void;
}) {
  return (
    <View className="mt-3 flex-row gap-2" accessibilityRole="radiogroup">
      {DUES_TERMS.map((t) => {
        const on = t.months === value;
        return (
          <Pressable
            key={t.months}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(t.months)}
            className={`h-10 flex-1 items-center justify-center rounded-full ${on ? 'bg-ink' : 'bg-field'}`}
          >
            <Text className={`font-jk-b text-micro ${on ? 'text-canvas' : 'text-muted'}`}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** "Pay ₦25,000" or "Pay 3 months · ₦75,000". */
function payLabel(months: number, total: number | null, currency: string, prefix = 'Pay'): string {
  const money = total === null ? '' : ` · ${formatMoney(total, currency)}`;
  return months === 1
    ? `${prefix}${total === null ? '' : ` ${formatMoney(total, currency)}`}`
    : `${prefix} ${months} months${money}`;
}

/** One month, in either section. Actions only ever appear on an open charge. */
function ChargeRow({
  charge: r,
  paying,
  months = 1,
  termTotal = null,
  onPay,
  onShare,
}: {
  charge: DuesCharge;
  paying: string | null;
  months?: number;
  termTotal?: number | null;
  onPay?: () => void;
  onShare?: () => void;
}) {
  return (
    <Card className="mt-3 p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="font-jk-b text-body text-ink">{periodLabel(r.period)}</Text>
          <Text className="mt-1 font-jk text-micro text-muted">
            {formatMoney(r.amount_minor, r.currency)} · due {dayLabel(r.due_on)}
          </Text>
        </View>
        {r.status === 'paid' ? (
          <Chip label="Paid" tone="lime" />
        ) : r.status === 'waived' ? (
          <Chip label="Waived" tone="field" />
        ) : r.is_overdue ? (
          <Chip label="Overdue" tone="ink" />
        ) : (
          <Chip label="Due" tone="field" />
        )}
      </View>

      {r.status === 'open' && onPay ? (
        r.billing_mode === 'per_house' && onShare ? (
          // Handing the bill over is the primary action here. Paying it stays
          // available and secondary, because a tenant often does settle and
          // square up privately -- but it is not what the app should be asking
          // them to do.
          <>
            <PrimaryButton
              title="Send this bill to the landlord"
              onPress={onShare}
              className="mt-3.5"
            />
            <SecondaryButton
              title={
                paying === r.charge_id
                  ? 'Opening…'
                  : months === 1
                    ? `Pay it yourself · ${formatMoney(r.amount_minor, r.currency)}`
                    : payLabel(months, termTotal, r.currency, 'Pay it yourself ·')
              }
              onPress={onPay}
              disabled={paying !== null}
              className="mt-2.5"
            />
          </>
        ) : (
          <PrimaryButton
            title={
              paying === r.charge_id
                ? 'Opening…'
                : payLabel(months, months === 1 ? r.amount_minor : termTotal, r.currency)
            }
            onPress={onPay}
            disabled={paying !== null}
            className="mt-3.5"
          />
        )
      ) : null}
    </Card>
  );
}
