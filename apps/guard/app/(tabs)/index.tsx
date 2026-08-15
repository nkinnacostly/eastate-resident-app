import { CODE_LENGTH } from '@estate/core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CodeBoxes, Keypad } from '@/components/keypad';
import { Eyebrow, StatusDot, WarnBanner } from '@/components/ui';
import { useShift } from '@/lib/shift';
import { verifyOffline, verifyOnline } from '@/lib/verify';

function minutes(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return 'just now';
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`;
}

export default function Check() {
  const { post, online, poolCount, poolAgeSeconds, stale, refresh } = useShift();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (!post || value.length !== CODE_LENGTH) return;
    setBusy(true);
    try {
      // Online verdicts are authoritative; offline ones are provisional and say
      // so on the verdict screen. The choice is made HERE rather than by
      // catching a network error, so a slow gate does not double-burn a code.
      const verdict = online
        ? await verifyOnline(post.estate_id, value)
        : await verifyOffline(value);

      setValue('');
      router.push({
        pathname: '/verdict',
        params: { v: JSON.stringify(verdict) },
      });
    } catch (e) {
      // The server was reachable a moment ago and is not now. Fall back to the
      // pool rather than making the guard retype — the visitor is waiting.
      try {
        const verdict = await verifyOffline(value);
        setValue('');
        router.push({ pathname: '/verdict', params: { v: JSON.stringify(verdict) } });
      } catch {
        Alert.alert('Could not check that code', (e as Error).message);
      }
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <View className="flex-1 px-4 pb-2">
        <View className="mt-1.5 flex-row items-center justify-between px-1">
          <View>
            <Eyebrow className="text-muted">
              {(post?.estate_name ?? '').toUpperCase()}
            </Eyebrow>
            <Text className="mt-1 font-jk-xb text-[15px] text-ink">Check a code</Text>
          </View>
          <StatusDot online={online} label={online ? 'Synced' : 'Offline'} />
        </View>

        {!online || stale ? (
          <View className="mt-3.5">
            <WarnBanner>
              Checking against {poolCount} codes held on this phone · last sync{' '}
              {minutes(poolAgeSeconds)}
            </WarnBanner>
          </View>
        ) : null}

        <View className="mt-4">
          <CodeBoxes value={value} />
        </View>

        <View className="mt-2.5 flex-row items-center justify-between px-1">
          <Text className="font-jk-sb text-micro text-muted">{poolCount} codes live</Text>
          <Text className="font-jk-sb text-micro text-muted">
            {online ? 'Verifying with the server' : 'Verifying on this phone'}
          </Text>
        </View>

        <View className="flex-1" />

        <Keypad value={value} onChange={setValue} onSubmit={submit} busy={busy} />

        {/* Clears the floating nav bar. */}
        <View className="h-[70px]" />
      </View>
    </SafeAreaView>
  );
}
