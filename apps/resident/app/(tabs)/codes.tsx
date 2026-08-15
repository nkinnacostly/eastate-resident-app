import { MAX_ACTIVE_CODES_PER_RESIDENT } from '@estate/core';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Card, Chip, CodeText, Eyebrow, Screen } from '@/components/ui';
import { useCodesOnFocus } from '@/lib/codes';
import { madeAt, timeLeft } from '@/lib/format';

export default function Codes() {
  const { live, loading, refresh } = useCodesOnFocus();
  const router = useRouter();
  const atCap = live.length >= MAX_ACTIVE_CODES_PER_RESIDENT;

  // Which slot frees up first — the thing a capped resident actually wants.
  const soonest = [...live].sort(
    (a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime(),
  )[0];

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-28"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      >
        <Text className="mt-3 font-jk-xb text-display tracking-tight text-ink">Live codes</Text>

        {atCap && soonest ? (
          <Card className="mt-4 bg-ink p-4">
            <Eyebrow className="text-lime">
              CAP REACHED · {live.length} OF {MAX_ACTIVE_CODES_PER_RESIDENT}
            </Eyebrow>
            <Text className="mt-2.5 font-jk text-sub text-canvas/75">
              A slot frees when {soonest.code} expires in {timeLeft(soonest.expires_at)}, or as soon
              as any code is used.
            </Text>
          </Card>
        ) : (
          <Card className="mt-4 p-4">
            <Text className="font-jk text-sub text-muted">
              {live.length} of {MAX_ACTIVE_CODES_PER_RESIDENT} slots in use. Codes die after six
              hours whether or not anyone arrives.
            </Text>
          </Card>
        )}

        <View className="mt-3.5 gap-2.5">
          {live.map((c) => (
            <Pressable
              key={c.id}
              onPress={() =>
                router.push({ pathname: '/code/[code]', params: { code: c.code } })
              }
            >
              <Card className="flex-row items-center justify-between p-4">
                <View>
                  <CodeText code={c.code} className="text-[22px]" />
                  <Text className="mt-1.5 font-jk text-micro text-muted">
                    {madeAt(c.created_at)}
                  </Text>
                </View>
                <Chip label={timeLeft(c.expires_at)} />
              </Card>
            </Pressable>
          ))}
        </View>

        {live.length === 0 ? (
          <Text className="mt-6 text-center font-jk text-sub text-muted">
            Nothing live right now.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
