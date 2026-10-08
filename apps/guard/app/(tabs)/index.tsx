import { CODE_LENGTH } from '@estate/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CodeBoxes, Keypad } from '@/components/keypad';
import { Eyebrow, StatusDot, TAB_BAR_CLEARANCE, WarnBanner } from '@/components/ui';
import { codeSchema, type CodeValues } from '@/lib/schemas';
import { useShift } from '@/lib/shift';
import { holdVerdict } from '@/lib/verdicts';
import { verifyOffline, verifyOnline, type Verdict } from '@/lib/verify';

function minutes(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return 'just now';
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`;
}

export default function Check() {
  const { post, online, poolCount, poolAgeSeconds, stale, authorisationExpired, refresh } =
    useShift();
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

  // The route carries an opaque id, never the verdict. A verdict in the URL
  // is one anybody can write: the scheme is exported, so a visitor could send
  // the guard a link that paints "Let them in -- checked with the server"
  // without the server ever being asked. See lib/verdicts.
  const show = (verdict: Verdict) => {
    router.push({ pathname: '/verdict', params: { id: holdVerdict(verdict) } });
  };

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
      show(verdict);
    } catch (e) {
      // The server was reachable a moment ago and is not now. Fall back to the
      // pool rather than making the guard retype — the visitor is waiting.
      try {
        const verdict = await verifyOffline(code);
        reset();
        show(verdict);
      } catch {
        Alert.alert('Could not check that code', (e as Error).message);
      }
    } finally {
      void refresh();
    }
  });

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <View className="flex-1 px-4">
        <View className="mt-1.5 flex-row items-center justify-between px-1">
          <View>
            <Eyebrow className="text-muted">
              {(post?.estate_name ?? '').toUpperCase()}
            </Eyebrow>
            <Text className="mt-1 font-jk-xb text-[15px] text-ink">Check a code</Text>
          </View>
          <StatusDot online={online} label={online ? 'Synced' : 'Offline'} />
        </View>

        {!online && authorisationExpired ? (
          <View className="mt-3.5">
            {/* Ranked above the ordinary stale banner: that one says answers
                may be old, this one says there are no answers. Showing both
                would bury the one the guard has to act on. */}
            <WarnBanner>
              Out of contact for {minutes(poolAgeSeconds)} — longer than a code stays valid, so
              every code on this phone has expired. Get signal and sync before checking anyone in.
            </WarnBanner>
          </View>
        ) : !online || stale ? (
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
                //
                // Same reasoning for an expired authorisation, one step
                // earlier: verifyOffline would return 'locked' and the guard
                // would have typed six characters to be told the phone cannot
                // answer. The banner above already says so; the key should not
                // invite the tap. When the phone is ONLINE this does not apply
                // — a server check re-proves authorisation by making it.
                canSubmit={isValid && Boolean(post) && (online || !authorisationExpired)}
              />
            </>
          )}
        />

        {/* Clears the floating nav bar, and leaves a real gap above it. The
            Check key is the most-tapped control in the app and sat flush
            against the bar, so a thumb reaching for it could catch Log. */}
        <View style={{ height: TAB_BAR_CLEARANCE }} />
      </View>
    </SafeAreaView>
  );
}
