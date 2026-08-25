import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArrowLeft } from '@/components/icons';
import { Field, FormError, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { resetPasswordSchema, type ResetPasswordValues } from '@/lib/schemas';

/**
 * Step two of two: redeem the code and choose the new password.
 *
 * BOTH on one screen, and that is a correctness requirement rather than a
 * layout preference. Redeeming a recovery code signs the resident in, and the
 * gate in app/_layout removes the (auth) stack the instant a session exists.
 * A screen that only took the code would therefore be unmounted the moment it
 * succeeded, with nowhere left to ask for a password. The provider holds the
 * session back until the password is actually set — see `suppressSession` in
 * lib/auth — and that only works if both values are in hand before it starts.
 *
 * On success there is no navigation to do here: the password is changed, the
 * session is released, and the gate moves the app to the tabs (or to /join) on
 * its own.
 */
export default function ResetPassword() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const { completePasswordReset, requestPasswordReset } = useAuth();
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);
  const [resending, setResending] = useState(false);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<ResetPasswordValues>({
    mode: 'onTouched',
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { code: '', password: '' },
  });

  const submit = handleSubmit(async ({ code, password }) => {
    if (!email) return;
    const result = await completePasswordReset(email, code, password);

    if (result.status === 'ok') {
      // Nothing to navigate: the gate has already swapped the stack out from
      // under this screen. Anything queued after this point would be setting
      // state on a component that no longer exists.
      return;
    }

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
    const { error } = await requestPasswordReset(email);
    setResending(false);
    Alert.alert(
      error ? 'Could not send a new code' : 'New code sent',
      error ??
        'Use the newest code in your inbox — asking for a new one turns off the previous code.',
    );
  };

  // Reachable with no address only via a stray deep link. The form cannot
  // work without one, so say so rather than rendering inputs that can only fail.
  if (!email) {
    return (
      <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
        <View className="flex-1 justify-center px-5">
          <Text className="font-jk-xb text-title text-ink">Start again</Text>
          <Text className="mt-2 font-jk text-body text-muted">
            We need the email address the code was sent to.
          </Text>
          <PrimaryButton
            title="Back to reset"
            onPress={() => router.replace('/(auth)/forgot-password')}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          className="mt-2 h-11 w-11 justify-center"
        >
          <ArrowLeft color="#16181c" size={19} />
        </Pressable>

        <View className="flex-1 justify-center">
          <Text className="max-w-measure font-jk-xb text-display tracking-tight text-ink">
            Enter your code
          </Text>
          <Text className="mt-2 max-w-measure font-jk text-body text-muted">
            We sent it to {email}. It expires in an hour.
          </Text>

          <View className="mt-7 gap-1">
            <Controller
              control={control}
              name="code"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  label="Reset code"
                  placeholder="Code from your email"
                  keyboardType="number-pad"
                  // The OS offers the code straight from the notification, which
                  // removes the trip out to the mail app that loses most people.
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  autoCorrect={false}
                  // Long enough for the 8 digits this project issues without
                  // capping a longer code if otp_length is ever raised.
                  maxLength={10}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.code?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  ref={passwordRef}
                  label="New password"
                  placeholder="New password"
                  secureTextEntry
                  autoCapitalize="none"
                  // `new-password` rather than `current-password`, so the
                  // keychain offers to SAVE this one instead of filling the old.
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                />
              )}
            />
          </View>

          {errors.root?.message ? <FormError>{errors.root.message}</FormError> : null}

          <PrimaryButton
            title={isSubmitting ? 'Saving…' : 'Set new password'}
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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
