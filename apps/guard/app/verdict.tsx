import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, DarkButton, Eyebrow, OutlineButton, PrimaryButton } from '@/components/ui';
import { useShift } from '@/lib/shift';
import { admitAndFlag, REJECT_COPY, type Verdict } from '@/lib/verify';

function clock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="mt-2 flex-row justify-between">
      <Text className="font-jk-sb text-sub text-muted">{label}</Text>
      <Text className="font-jk-sb text-sub text-ink">{value}</Text>
    </View>
  );
}

export default function VerdictScreen() {
  const { v } = useLocalSearchParams<{ v: string }>();
  const router = useRouter();
  const { refresh } = useShift();
  const [verdict, setVerdict] = useState<Verdict | null>(() => {
    try {
      return JSON.parse(v) as Verdict;
    } catch {
      return null;
    }
  });

  const done = () => {
    void refresh();
    router.replace('/(tabs)');
  };

  if (!verdict) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-canvas">
        <Text className="font-jk text-body text-muted">No verdict to show.</Text>
        <PrimaryButton title="Back to keypad" onPress={done} className="mt-4 w-56" />
      </SafeAreaView>
    );
  }

  const source =
    verdict.checkedWith === 'server' ? 'CHECKED WITH THE SERVER' : 'CHECKED ON THIS PHONE';

  // ── Admitted ──────────────────────────────────────────────────────────────
  if (verdict.decision === 'admit') {
    return (
      <SafeAreaView className="flex-1 bg-lime" edges={['top', 'bottom']}>
        <View className="flex-1 px-5 pb-6">
          <Eyebrow className="mt-3 text-ink/55">{source}</Eyebrow>
          <Text className="mt-5 font-jk-xb text-[46px] leading-[50px] tracking-tight text-ink">
            Let{'\n'}them in
          </Text>

          <Card className="mt-7 p-5">
            <Text className="font-jk-xb text-[24px] tracking-code text-ink">{verdict.code}</Text>
            <View className="my-3.5 h-px bg-field" />
            {/* Host is null on an offline verdict — the pool deliberately does
                not carry resident names, so a stolen guard phone is not the
                estate's directory. Saying so is better than a blank row. */}
            <Row
              label="Host"
              value={
                verdict.host
                  ? verdict.host.unit
                    ? `${verdict.host.name} · Unit ${verdict.host.unit}`
                    : verdict.host.name
                  : 'Not available offline'
              }
            />
            <Row label="Entries" value="One — this was it" />
            <Row label="Checked" value={clock(verdict.issuedAt)} />
          </Card>

          <View className="flex-1" />

          <Text className="mb-3 font-jk text-sub text-ink/65">
            {verdict.checkedWith === 'server'
              ? 'Code burned. The resident has been notified.'
              : 'Burned on this phone. It uploads when signal returns.'}
          </Text>
          <DarkButton title="Next visitor" onPress={done} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Flagged ───────────────────────────────────────────────────────────────
  if (verdict.decision === 'flagged') {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
        <View className="flex-1 px-5 pb-6">
          <View className="mt-3 self-start rounded-full bg-coral px-3 py-1.5">
            <Text className="font-jk-b text-label tracking-label text-white">FLAGGED ENTRY</Text>
          </View>
          <Text className="mt-4 max-w-[15ch] font-jk-xb text-[30px] leading-[34px] tracking-tight text-ink">
            Admitted without a match
          </Text>

          <Card className="mt-5 p-5">
            <Text className="font-jk-xb text-[22px] tracking-code text-ink">{verdict.code}</Text>
            <View className="my-3.5 h-px bg-field" />
            <Row label="Device time" value={clock(new Date().toISOString())} />
            <Row label="Status" value="Queued to sync" />
          </Card>

          <Text className="mt-4 font-jk text-sub text-muted">
            When signal returns this goes to the estate admin to reconcile, with your name on it.
          </Text>

          <View className="flex-1" />
          <PrimaryButton title="Next visitor" onPress={done} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Refused ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-ink" edges={['top', 'bottom']}>
      <View className="flex-1 px-5 pb-6">
        <View className="mt-3 flex-row items-center gap-2">
          <View className="h-1.5 w-1.5 rounded-full bg-coral" />
          <Eyebrow className="text-canvas/60">{source}</Eyebrow>
        </View>

        <Text className="mt-5 font-jk-xb text-[46px] leading-[50px] tracking-tight text-canvas">
          Do not{'\n'}admit
        </Text>

        <Card className="mt-7 bg-canvas/10 p-5">
          <Text className="font-jk-xb text-[24px] tracking-code text-canvas">{verdict.code}</Text>
          <Text className="mt-3 font-jk-xb text-[16px] text-coral">
            {REJECT_COPY[verdict.reason]}
          </Text>
          <Text className="mt-2 font-jk text-sub leading-[20px] text-canvas/70">
            {verdict.detail ??
              (verdict.checkedWith === 'device'
                ? 'Checked against the codes on this phone. A code issued during the outage may not be here yet.'
                : 'A returning visitor needs a fresh code.')}
          </Text>
        </Card>

        <View className="flex-1" />

        <View className="gap-2.5">
          {/* The override. Only offered when the verdict came from a possibly
              incomplete local pool — overriding the SERVER would be admitting
              a code it authoritatively refused, which is not a judgement call
              a gate should be able to make. */}
          {verdict.checkedWith === 'device' ? (
            <OutlineButton
              title="Admit anyway and flag it"
              onPress={async () => {
                setVerdict(await admitAndFlag(verdict.code));
              }}
            />
          ) : null}
          <PrimaryButton title="Back to keypad" onPress={done} />
        </View>
      </View>
    </SafeAreaView>
  );
}
