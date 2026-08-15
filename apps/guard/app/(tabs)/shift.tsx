import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, PrimaryButton, StatusDot, WarnBanner } from '@/components/ui';
import { useShift } from '@/lib/shift';

function ago(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return 'seconds ago';
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between py-3">
      <Text className="font-jk-sb text-sub text-muted">{label}</Text>
      {typeof value === 'string' ? (
        <Text className="font-jk-sb text-sub text-ink">{value}</Text>
      ) : (
        value
      )}
    </View>
  );
}

export default function Shift() {
  const {
    session, post, online, poolCount, queued, poolAgeSeconds, syncing, sync, endShift,
  } = useShift();

  const name = (session?.user.user_metadata?.full_name as string | undefined) ?? 'Guard';

  const confirmEnd = () => {
    Alert.alert(
      'End shift?',
      queued > 0
        ? `${queued} verification${queued === 1 ? '' : 's'} still need to upload. Ending the shift uploads them first, then signs you out.`
        : 'This signs you out and clears the codes held on this phone.',
      [
        { text: 'Stay on duty', style: 'cancel' },
        { text: 'End shift', style: 'destructive', onPress: () => void endShift() },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <ScrollView
        className="flex-1 px-5"
        contentContainerClassName="pb-28"
        showsVerticalScrollIndicator={false}
      >
        <Text className="mt-3 font-jk-xb text-display tracking-tight text-ink">{name}</Text>
        <Text className="mt-1.5 font-jk text-sub text-muted">
          {post?.estate_name ?? 'No post'} · {session?.user.email ?? ''}
        </Text>

        {queued > 0 ? (
          <View className="mt-4">
            <WarnBanner>
              {queued} {queued === 1 ? 'verification is' : 'verifications are'} queued. Do not sign
              out on a dead battery — they live on this phone until they upload.
            </WarnBanner>
          </View>
        ) : null}

        <Card className="mt-4 px-4 py-1">
          <Row label="Connection" value={<StatusDot online={online} label={online ? 'Online' : 'Offline'} />} />
          <View className="h-px bg-field" />
          <Row label="Codes on this phone" value={String(poolCount)} />
          <View className="h-px bg-field" />
          <Row label="Last sync" value={ago(poolAgeSeconds)} />
          <View className="h-px bg-field" />
          <Row label="Waiting to upload" value={String(queued)} />
        </Card>

        <PrimaryButton
          title={syncing ? 'Syncing…' : 'Sync now'}
          onPress={() => void sync()}
          disabled={syncing}
          className="mt-5"
        />

        <Card className="mt-6 p-4">
          <Text className="font-jk text-sub text-muted">
            A stale pool still admits. Refusing to verify on old data would turn a network outage
            into a gate outage — every check is logged with how old the pool was.
          </Text>
        </Card>

        <PrimaryButton title="End shift" onPress={confirmEnd} className="mt-6 bg-field" />
      </ScrollView>
    </SafeAreaView>
  );
}
