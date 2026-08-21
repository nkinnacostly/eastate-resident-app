import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Field, FormError, PrimaryButton } from '@/components/ui';
import { myPendingJoinRequests, requestHouseAccess, type JoinResult } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { joinSchema, type JoinValues } from '@/lib/schemas';

/** Copy for the outcomes that leave someone still outside. */
const REJECTION: Record<string, { title: string; body: string }> = {
  unknown_estate: {
    title: 'Estate code not recognised',
    body: 'Check it with your estate office.',
  },
  unknown_house: {
    title: 'House code not recognised',
    body: 'Check it with your landlord.',
  },
  rate_limited: {
    title: 'Too many tries',
    body: 'Wait a minute and try again.',
  },
};

/**
 * Shown to a signed-in resident who belongs to no estate yet.
 *
 * The two codes are collected at sign-up, so most people arrive here already
 * waiting and this screen only has to say so. It still keeps the form, because
 * it has to serve three other arrivals: someone whose codes did not match,
 * someone who registered before the codes were part of sign-up, and someone
 * moving to a second estate.
 *
 * Whether a request exists is read from the server, not remembered on the
 * device — local state is empty after a restart, and showing a blank form to
 * someone who is simply waiting reads as "nothing was sent".
 */
export default function Join() {
  const { signOut, refreshMemberships, takeSignUpJoinResult } = useAuth();
  const [checking, setChecking] = useState(true);
  const [sent, setSent] = useState<{ estate: string; house: string | null } | null>(null);
  const [rejected, setRejected] = useState<{ title: string; body: string } | null>(null);
  const houseRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<JoinValues>({
    resolver: zodResolver(joinSchema),
    mode: 'onTouched',
    defaultValues: { estateCode: '', houseCode: '' },
  });

  const apply = useCallback(
    async (res: JoinResult) => {
      switch (res.result) {
        case 'ok':
        case 'already_pending':
          setRejected(null);
          setSent({ estate: res.estate_name, house: res.house_number });
          return;
        case 'already_a_member':
          // An admin approved them while this was open. Reloading memberships
          // is what lets the gate move them on.
          await refreshMemberships();
          return;
        default:
          setSent(null);
          setRejected(REJECTION[res.result]);
      }
    },
    [refreshMemberships],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      // The sign-up handoff first: it is the only place a "code not recognised"
      // can come from, since a rejected request leaves nothing on the server to
      // read back.
      const fromSignUp = takeSignUpJoinResult();
      if (fromSignUp) await apply(fromSignUp);

      try {
        const pending = await myPendingJoinRequests();
        if (!live) return;
        const first = pending[0];
        if (first) {
          setRejected(null);
          setSent({ estate: first.estate_name, house: first.house_number });
        }
      } catch {
        // A failed lookup is not evidence there is no request — fall through to
        // the form rather than claiming nothing was sent.
      } finally {
        if (live) setChecking(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [apply, takeSignUpJoinResult]);

  // Both values arrive trimmed by the schema — a stray space would not match
  // either stored code.
  const submit = handleSubmit(async ({ estateCode, houseCode }) => {
    try {
      await apply(await requestHouseAccess(estateCode, houseCode));
    } catch (e) {
      const message = (e as Error).message;
      // Kept on screen as well as alerted: this is the last screen before the
      // app is unusable, and an alert dismissed by accident leaves no trace of
      // why nothing happened.
      setError('root', { message });
      Alert.alert('Could not send the request', message);
    }
  });

  if (checking) {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (sent) {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
        <View className="flex-1 justify-center px-5">
          <Text className="max-w-measure font-jk-xb text-display tracking-tight text-ink">
            Waiting on approval
          </Text>
          <Text className="mt-3 max-w-measure font-jk text-body text-muted">
            {sent.house ? `House ${sent.house}, ${sent.estate}` : sent.estate}. An estate admin has
            to approve you before you can make codes. You will see this screen until they do.
          </Text>
          <PrimaryButton
            title="Check again"
            onPress={() => void refreshMemberships()}
            className="mt-7"
          />
          <Pressable onPress={signOut} className="mt-4 h-11 justify-center">
            <Text className="text-center font-jk-sb text-sub text-muted">Sign out</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 px-5"
      >
        <View className="flex-1 justify-center">
          <Text className="max-w-measure font-jk-xb text-display tracking-tight text-ink">
            {rejected ? rejected.title : 'Join your estate'}
          </Text>
          <Text className="mt-3 max-w-measure font-jk text-body text-muted">
            {rejected
              ? `${rejected.body} Your account is saved — enter the codes again below.`
              : 'Two codes: one from your estate, one from your landlord. Together they place you in the right house.'}
          </Text>

          <View className="mt-7 gap-1">
            {/* Presence is the only rule the client applies. request_house_access
                normalises case and separators before it looks a code up, so a
                format rule here would refuse codes the estate actually issued —
                on the one screen where being wrongly refused leaves someone with
                no way into the app at all. */}
            <Controller
              control={control}
              name="estateCode"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  label="Estate code"
                  placeholder="Estate code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => houseRef.current?.focus()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.estateCode?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="houseCode"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  ref={houseRef}
                  label="House code"
                  placeholder="House code"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.houseCode?.message}
                />
              )}
            />
          </View>

          {errors.root?.message ? <FormError>{errors.root.message}</FormError> : null}

          <PrimaryButton
            title={isSubmitting ? 'Sending…' : 'Request access'}
            onPress={() => void submit()}
            // A house code alone cannot place anyone — it is only unique within
            // its estate — so half the pair must never reach the server.
            disabled={!isValid || isSubmitting}
            className="mt-5"
          />

          <Pressable onPress={signOut} className="mt-4 h-11 justify-center">
            <Text className="text-center font-jk-sb text-sub text-muted">Sign out</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
