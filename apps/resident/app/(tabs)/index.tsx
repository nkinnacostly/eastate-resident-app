import { MAX_ACTIVE_CODES_PER_RESIDENT } from '@estate/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { DeliveryPrompt } from '@/components/delivery-prompt';
import { Card, Chip, CodeText, Eyebrow, PrimaryButton, Screen } from '@/components/ui';
import type { DeliveryDetails } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCodesOnFocus } from '@/lib/codes';
import { madeAt, timeLeft } from '@/lib/format';

export default function Home() {
  const { session, memberships, activeEstateId } = useAuth();
  const { live, loading, refresh, mint } = useCodesOnFocus();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const router = useRouter();

  const estate = memberships.find((m) => m.estate_id === activeEstateId);
  const fullName = (session?.user.user_metadata?.full_name as string | undefined) ?? '';
  const firstName = fullName.split(' ')[0] || 'there';

  /**
   * The delivery question is asked BEFORE anything is minted.
   *
   * It has to be: `is_delivery` and the note are written by mint_access_code in
   * the same statement that inserts the row, and there is deliberately no
   * client write path to `access_codes` to go back and amend one afterwards.
   */
  const generate = async (delivery: DeliveryDetails) => {
    if (!activeEstateId) return;
    setBusy(true);
    try {
      const res = await mint(delivery);
      // Closed before any Alert. An alert raised while the modal is still up
      // is presented behind it on iOS, so the resident sees a frozen sheet and
      // no explanation.
      setAsking(false);
      if (!res) return;
      // These are RESULTS, not errors — the function deliberately does not
      // raise for expected outcomes (Technical Design §3.1).
      switch (res.result) {
        case 'ok':
          router.push({ pathname: '/code/[code]', params: { code: res.code } });
          break;
        case 'code_limit_reached':
          router.push('/(tabs)/codes');
          break;
        case 'rate_limited':
          Alert.alert('Slow down', 'Too many requests just now. Try again in a minute.');
          break;
        case 'not_a_resident':
          Alert.alert('No access', 'You are not an active resident at this estate.');
          break;
        case 'note_too_long':
          Alert.alert(
            'Instructions too long',
            'Shorten the delivery instructions and try again.',
          );
          break;
        default:
          Alert.alert('Could not generate a code', 'Please try again.');
      }
    } catch (e) {
      setAsking(false);
      Alert.alert('Could not generate a code', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-28"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      >
        <View className="mt-2 flex-row items-center justify-between">
          <View>
            <Eyebrow className="text-muted">{(estate?.estate_name ?? '').toUpperCase()}</Eyebrow>
            <Text className="mt-1 font-jk-xb text-[26px] tracking-tight text-ink">
              Hi, {firstName}
            </Text>
          </View>
          <View className="h-11 w-11 rounded-full bg-hair" />
        </View>

        <Card className="mt-6 bg-ink p-5">
          <Eyebrow className="text-lime">EXPECTING SOMEONE?</Eyebrow>
          {/* `leading-[1.15]` was unitless — a CSS multiplier that has no
              meaning as a React Native lineHeight. The scale carries leading. */}
          {/* No longer "one tap": a code now starts with the delivery question,
              and copy that promises otherwise is the kind of small lie a
              resident notices on their first use. */}
          <Text className="mt-3 font-jk-xb text-[25px] leading-[30px] tracking-tight text-canvas">
            Make a code in seconds
          </Text>
          <PrimaryButton
            title={busy ? 'Generating…' : 'Generate code'}
            onPress={() => setAsking(true)}
            disabled={busy || !activeEstateId}
            className="mt-5"
          />
        </Card>

        <View className="mt-7 flex-row items-center justify-between">
          <Text className="font-jk-b text-title text-ink">Live codes</Text>
          <Text className="font-jk-sb text-sub text-muted">
            {live.length} of {MAX_ACTIVE_CODES_PER_RESIDENT}
          </Text>
        </View>

        {live.length === 0 ? (
          <Card className="mt-3 p-4">
            <Text className="font-jk text-sub text-muted">
              No live codes. Generate one when a visitor is on the way — it lasts six hours.
            </Text>
          </Card>
        ) : (
          <View className="mt-3 gap-2.5">
            {live.map((c) => (
              // A freshly minted code drops into the list instead of blinking
              // into existence; the rest slide down to make room.
              <Animated.View
                key={c.id}
                entering={FadeInDown.duration(260)}
                exiting={FadeOut.duration(160)}
                layout={LinearTransition.springify().damping(18)}
              >
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/code/[code]', params: { code: c.code } })
                }
              >
                <Card className="flex-row items-center justify-between p-4">
                  <View>
                    <CodeText code={c.code} className="text-[23px]" />
                    <Text className="mt-1.5 font-jk text-micro text-muted">
                      {madeAt(c.created_at)}
                    </Text>
                  </View>
                  <Chip label={timeLeft(c.expires_at)} />
                </Card>
              </Pressable>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>

      <DeliveryPrompt
        visible={asking}
        busy={busy}
        onCancel={() => setAsking(false)}
        onSubmit={generate}
      />
    </Screen>
  );
}
