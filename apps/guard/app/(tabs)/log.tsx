import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, WarnBanner } from '@/components/ui';
import { recentEvents, type OutboxRow } from '@/lib/db';
import { useShift } from '@/lib/shift';
import { REJECT_COPY } from '@/lib/verify';

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function subtitle(e: OutboxRow): string {
  const t = clock(e.verified_at);
  if (e.outcome === 'flagged') return `${t} · flagged`;
  if (e.outcome === 'rejected') {
    const why = e.reject_reason ? REJECT_COPY[e.reject_reason as keyof typeof REJECT_COPY] : null;
    return `${t} · ${why?.toLowerCase() ?? 'refused'}`;
  }
  return `${t} · ${e.synced ? 'synced' : 'queued'}`;
}

function Tag({ e }: { e: OutboxRow }) {
  if (e.outcome === 'flagged') {
    return (
      <View className="h-6 justify-center rounded-full bg-coral-chip px-2.5">
        <Text className="font-jk-b text-label text-coral-ink">Flagged</Text>
      </View>
    );
  }
  if (e.outcome === 'rejected') {
    return (
      <View className="h-6 justify-center rounded-full bg-field px-2.5">
        <Text className="font-jk-b text-label text-muted">Refused</Text>
      </View>
    );
  }
  return (
    <View className="h-6 justify-center rounded-full bg-lime px-2.5">
      <Text className="font-jk-b text-label text-ink">Admitted</Text>
    </View>
  );
}

export default function Log() {
  const { queued, sync, syncing } = useShift();
  const [rows, setRows] = useState<OutboxRow[]>([]);

  const load = useCallback(async () => setRows(await recentEvents()), []);

  // On FOCUS, not on mount. Tab screens stay mounted, so a mount-only effect
  // never re-runs — the guard would verify a code, switch to Log, and see the
  // list as it was when the tab first rendered.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <ScrollView
        className="flex-1 px-5"
        contentContainerClassName="pb-28"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={async () => {
              await sync();
              await load();
            }}
          />
        }
      >
        <Text className="mt-3 font-jk-xb text-display tracking-tight text-ink">This shift</Text>
        <Text className="mt-1.5 font-jk text-sub text-muted">
          {rows.length} {rows.length === 1 ? 'check' : 'checks'} on this phone
        </Text>

        {queued > 0 ? (
          <View className="mt-4">
            <WarnBanner>
              {queued} {queued === 1 ? 'verification' : 'verifications'} waiting to upload. They
              sync automatically.
            </WarnBanner>
          </View>
        ) : null}

        <View className="mt-4 gap-2.5">
          {rows.map((e) => (
            <Card key={e.client_event_id} className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-3">
                <Text className="font-jk-xb text-[15px] tracking-code text-ink">{e.code}</Text>
                <Text className="mt-1 font-jk text-micro text-muted">{subtitle(e)}</Text>
              </View>
              <Tag e={e} />
            </Card>
          ))}
        </View>

        {rows.length === 0 ? (
          <Text className="mt-8 text-center font-jk text-sub text-muted">
            No checks yet this shift.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
