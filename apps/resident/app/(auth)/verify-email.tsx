import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Field, FormError, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { verifyEmailSchema, type VerifyEmailValues } from '@/lib/schemas';

/**
 * The last step of sign-up, when the project requires email confirmation.
 *
 * Why this screen exists at all: confirming by CODE keeps the resident inside
 * the app, and staying inside the app is what lets their estate and house codes
 * survive. Those two values were typed on the previous screen and cannot become
 * a join request until there is a session; the provider holds them and spends
 * them the instant this succeeds. Confirming by link instead would finish the
 * job in a browser and strand them.
 *
 * There is no back control. Going back would land on a sign-up form for an
 * account that now EXISTS, so submitting it again fails with "already
 * registered" — a dead end that reads like the app is broken. The way out is
 * the sign-in link at the bottom: the account is real, so signing in works even
 * before confirmation is finished.
 *
 * On success nothing navigates from here. Verification signs them in, the gate
 * swaps the stack, and /join reports how the codes landed.
 */
export default function VerifyEmail() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const { completeSignUpVerification, resendSignUpCode } = useAuth();
  const router = useRouter();
  const [resending, setResending] = useState(false);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<VerifyEmailValues>({
    mode: 'onTouched',
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: { code: '' },
  });

  const submit = handleSubmit(async ({ code }) => {
    if (!email) return;
    const result = await completeSignUpVerification(email, code);

    if (result.status === 'ok') return;

    if (result.status === 'bad_code') {
      setError('code', {
        message: 'That code is wrong or has expired. Ask for a new one below.',
      });
      return;
    }

    setError('root', { message: result.message });
  });

  const resend = async () => {
    if (!email || resending) return;
    setResending(true);
    const { error } = await resendSignUpCode(email);
    setResending(false);
    Alert.alert(
      error ? 'Could not send a new code' : 'New code sent',
      error ??
        'Use the newest code in your inbox — asking for a new one turns off the previous code.',
    );
  };

  if (!email) {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
        <View className="flex-1 justify-center px-5">
          <Text className="font-jk-xb text-title text-ink">Start again</Text>
          <Text className="mt-2 font-jk text-body text-muted">
            We need the email address the code was sent to.
          </Text>
          <PrimaryButton
            title="Back to sign in"
            onPress={() => router.replace('/(auth)/sign-in')}
            className="mt-5"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 px-5 pb-6"
      >
        <View className="flex-1 justify-center">
          <Text className="max-w-measure font-jk-xb text-display tracking-tight text-ink">
            Confirm your email
          </Text>
          <Text className="mt-2 max-w-measure font-jk text-body text-muted">
            We sent a code to {email}. Enter it to finish setting up your account.
          </Text>

          <View className="mt-7">
            <Controller
              control={control}
              name="code"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  label="Confirmation code"
                  placeholder="Code from your email"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  autoCorrect={false}
                  maxLength={10}
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.code?.message}
                />
              )}
            />
          </View>

          {errors.root?.message ? <FormError>{errors.root.message}</FormError> : null}

          <PrimaryButton
            title={isSubmitting ? 'Confirming…' : 'Confirm email'}
            onPress={() => void submit()}
            disabled={!isValid || isSubmitting}
            className="mt-4"
          />

          <Pressable
            accessibilityRole="button"
            onPress={() => void resend()}
            disabled={resending}
            className="mt-6 h-11 justify-center"
          >
            <Text className="text-center font-jk-sb text-sub text-muted">
              {resending ? 'Sending…' : 'Send a new code'}
            </Text>
          </Pressable>

          {/* The escape hatch. Their account exists either way, so this is never
              a dead end — unlike going back to a sign-up form that would now
              refuse the same address. */}
          <Pressable
            onPress={() => router.replace('/(auth)/sign-in')}
            className="mt-2 h-11 justify-center"
          >
            <Text className="text-center font-jk-sb text-sub text-muted">
              Confirm later? <Text className="text-ink">Sign in</Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
