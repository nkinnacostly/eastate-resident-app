import { CODE_LENGTH } from '@estate/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CodeBoxes, Keypad } from '@/components/keypad';
import { Eyebrow, StatusDot, WarnBanner } from '@/components/ui';
import { codeSchema, type CodeValues } from '@/lib/schemas';
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
  const router = useRouter();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isValid, isSubmitting },
  } = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    // onChange, unlike the sign-in form: every keypress here is a whole
    // character of a six-character code, so validity is meaningful at each one
    // and the Check key must un-dim on the sixth tap without a blur to trigger it.
    mode: 'onChange',
    defaultValues: { code: '' },
  });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Only ever called with a code the schema accepted, and `code` is the PARSED
  // value — trimmed and upper-cased — so what reaches the server is what was
  // validated.
  const submit = handleSubmit(async ({ code }) => {
    if (!post) return;
    try {
      // Online verdicts are authoritative; offline ones are provisional and say
      // so on the verdict screen. The choice is made HERE rather than by
      // catching a network error, so a slow gate does not double-burn a code.
      const verdict = online
        ? await verifyOnline(post.estate_id, code)
        : await verifyOffline(code);

      reset();
      router.push({
        pathname: '/verdict',
        params: { v: JSON.stringify(verdict) },
      });
    } catch (e) {
      // The server was reachable a moment ago and is not now. Fall back to the
      // pool rather than making the guard retype — the visitor is waiting.
      try {
        const verdict = await verifyOffline(code);
        reset();
        router.push({ pathname: '/verdict', params: { v: JSON.stringify(verdict) } });
      } catch {
        Alert.alert('Could not check that code', (e as Error).message);
      }
    } finally {
      void refresh();
    }
  });

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

        <Controller
          control={control}
          name="code"
          render={({ field: { value, onChange, onBlur } }) => (
            <>
              <View className="mt-4">
                <CodeBoxes value={value} />
              </View>

              <View className="mt-2.5 flex-row items-center justify-between px-1">
                {/* The schema's complaint about a half-typed code is true but
                    useless — the empty boxes already say it. Only surface a
                    message once the guard has filled every box and it is STILL
                    refused, which is the case they cannot see for themselves. */}
                {value.length === CODE_LENGTH && errors.code?.message ? (
                  <Text className="font-jk-sb text-micro text-coral">{errors.code.message}</Text>
                ) : (
                  <Text className="font-jk-sb text-micro text-muted">{poolCount} codes live</Text>
                )}
                <Text className="font-jk-sb text-micro text-muted">
                  {online ? 'Verifying with the server' : 'Verifying on this phone'}
                </Text>
              </View>

              <View className="flex-1" />

              <Keypad
                value={value}
                onChange={onChange}
                onBlur={onBlur}
                onSubmit={() => void submit()}
                busy={isSubmitting}
                // No post means no estate to verify against — the RPC would be
                // rejected server-side anyway, so do not let the guard tap into
                // an error they cannot act on.
                canSubmit={isValid && Boolean(post)}
              />
            </>
          )}
        />

        {/* Clears the floating nav bar. */}
        <View className="h-[70px]" />
      </View>
    </SafeAreaView>
  );
}
