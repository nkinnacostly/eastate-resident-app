import { zodResolver } from '@hookform/resolvers/zod';
import { useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Field, PrimaryButton } from '@/components/ui';
import { signInSchema, type SignInValues } from '@/lib/schemas';
import { useShift } from '@/lib/shift';

export default function StartShift() {
  const { signIn, session, post } = useShift();
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    // onTouched, not onChange: a guard is mid-way through typing an email for
    // most of the keystrokes it takes to enter one, and flashing "that does not
    // look like an email address" at every character trains them to ignore the
    // message. Errors land on blur; `isValid` still tracks every keystroke, so
    // the button un-dims the moment the form is genuinely complete.
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  });

  // Receives the PARSED values — trimmed by the schema, so the address that
  // reaches Supabase is the one the schema validated, not the raw field.
  const submit = handleSubmit(async ({ email, password }) => {
    const { error } = await signIn(email, password);
    if (error) {
      // Attached to the form rather than shown only in an alert, so the reason
      // is still on screen after the guard dismisses it and tries again.
      // Deliberately on `password`: which of the two was wrong is exactly what
      // an auth error must not disclose.
      setError('password', { message: error });
      Alert.alert('Could not start shift', error);
    }
    // On success the Gate redirects once a guard post resolves.
  });

  // Signed in but not a guard anywhere: say so plainly rather than bouncing
  // them around a redirect loop with no explanation.
  const signedInWithoutPost = session && !post;

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 px-5 pb-6"
      >
        <View className="flex-1 justify-center">
          <Text className="max-w-measure font-jk-xb text-display tracking-tight text-ink">
            Start your shift
          </Text>
          <Text className="mt-2 max-w-measure font-jk text-body text-muted">
            Signing in downloads live codes so the gate works without signal.
          </Text>

          <View className="mt-7 gap-1">
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  label="Email"
                  placeholder="you@estate.co.za"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  // Moves to the password field instead of dismissing the
                  // keyboard. Focusing the next field blurs this one, which is
                  // what surfaces a bad address before the guard has typed a
                  // password for it. `submitBehavior` replaced `blurOnSubmit`
                  // in RN 0.79 — "submit" keeps the keyboard up for the focus
                  // handoff.
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  ref={passwordRef}
                  label="Password"
                  placeholder="Password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="current-password"
                  returnKeyType="go"
                  // Enter submits — but through the same handler as the button,
                  // so an invalid form is refused identically either way.
                  onSubmitEditing={() => void submit()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                />
              )}
            />
          </View>

          {signedInWithoutPost ? (
            <Card className="mt-4 bg-coral-wash p-4">
              <Text className="font-jk-md text-sub text-coral-ink">
                This account is signed in but is not an active guard at any estate. An admin has to
                assign you to a post.
              </Text>
            </Card>
          ) : null}

          <PrimaryButton
            title={isSubmitting ? 'Signing in…' : 'Sign in and sync'}
            onPress={() => void submit()}
            // isSubmitting is RHF's, and it stays true for the whole await —
            // so this is also the double-tap guard that stops two sign-in
            // requests racing on a slow connection at the gate.
            disabled={!isValid || isSubmitting}
            className="mt-4"
          />

          <Card className="mt-6 p-4">
            <Text className="font-jk text-sub text-muted">
              One guard verifies per gate at a time. Ending your shift hands over the post.
            </Text>
          </Card>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
