import { formatMoney } from '@estate/core';
import { useFocusEffect, useRouter } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Card, Chip, Eyebrow, PrimaryButton, Screen, SecondaryButton } from '@/components/ui';
import { listMyDues, startDuesPayment, type DuesCharge } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** "September 2026" from a date the server returns as 2026-09-01. */
function periodLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function Dues() {
  const { activeEstateId } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<DuesCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeEstateId) return;
    setLoading(true);
    try {
      setRows(await listMyDues(activeEstateId));
    } catch (e) {
      Alert.alert('Could not load your dues', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeEstateId]);

  // Re-read whenever the screen regains focus. That is what makes the list
  // correct after the in-app browser closes, whichever of the webhook or the
  // redirect settled the payment first.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const pay = async (charge: DuesCharge) => {
    setPaying(charge.charge_id);
    try {
      const link = await startDuesPayment(charge.charge_id);
      // An in-app browser, not a redirect out of the app. The resident comes
      // back here when it closes, and this screen re-reads on focus -- so the
      // list is correct whether the webhook or the return landed first.
      await openBrowserAsync(link);
      await load();
    } catch (e) {
      Alert.alert('Could not start the payment', (e as Error).message);
    } finally {
      setPaying(null);
    }
  };

  const outstanding = rows.filter((r) => r.status === 'open');
  const overdue = outstanding.filter((r) => r.is_overdue);
  const owed = outstanding.reduce((n, r) => n + r.amount_minor, 0);
  const currency = rows[0]?.currency ?? 'NGN';
  const perHouse = rows[0]?.subject === 'house';

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-28"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Text className="mt-3 font-jk-xb text-display tracking-tight text-ink">Estate dues</Text>

        {/* The reason they are here, said first and without euphemism. */}
        {overdue.length > 0 ? (
          <Card className="mt-4 bg-ink p-4">
            <Eyebrow className="text-lime">CODES PAUSED</Eyebrow>
            <Text className="mt-2.5 font-jk text-sub text-canvas/75">
              You cannot generate new visitor codes until this is settled. Your own access to the
              estate is unaffected, and a guard can still let a visitor in at the gate.
            </Text>
          </Card>
        ) : null}

        {outstanding.length > 0 ? (
          <Card className="mt-4 p-5">
            <Eyebrow className="text-muted">OUTSTANDING</Eyebrow>
            <Text className="mt-1.5 font-jk-xb text-[32px] tracking-tight text-ink">
              {formatMoney(owed, currency)}
            </Text>
            {perHouse ? (
              <Text className="mt-2 font-jk text-sub text-muted">
                Billed to your house, so anyone can settle it — you, your landlord, or whoever
                normally pays. Once it is paid, everyone in the house can generate codes again.
              </Text>
            ) : null}
          </Card>
        ) : (
          <Card className="mt-4 p-5">
            <Text className="font-jk text-sub text-muted">
              Nothing outstanding. {rows.length === 0 ? 'This estate does not collect dues through the app.' : 'You are up to date.'}
            </Text>
          </Card>
        )}

        {rows.map((r) => (
          <Card key={r.charge_id} className="mt-3 p-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="font-jk-b text-body text-ink">{periodLabel(r.period)}</Text>
                <Text className="mt-1 font-jk text-micro text-muted">
                  {formatMoney(r.amount_minor, r.currency)} · due {periodLabel(r.due_on)}
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

            {r.status === 'open' ? (
              <PrimaryButton
                title={paying === r.charge_id ? 'Opening…' : `Pay ${formatMoney(r.amount_minor, r.currency)}`}
                onPress={() => void pay(r)}
                disabled={paying !== null}
                className="mt-3.5"
              />
            ) : null}
          </Card>
        ))}

        {loading && rows.length === 0 ? (
          <ActivityIndicator className="mt-8" />
        ) : null}

        <SecondaryButton title="Back" onPress={() => router.back()} className="mt-6" />

        <Text className="mt-5 px-1 font-jk text-micro leading-[17px] text-muted">
          Payments are handled by Flutterwave. We never see or store your card details.
        </Text>
      </ScrollView>
    </Screen>
  );
}
