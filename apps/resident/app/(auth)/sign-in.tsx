import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
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

import { Field, FormError, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { signInSchema, type SignInValues } from '@/lib/schemas';

export default function SignIn() {
  const { signIn } = useAuth();
  const router = useRouter();
  const passwordRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    // onTouched, not onChange: someone is mid-way through typing an address for
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
    // On success the Gate in app/_layout redirects — nothing to do here.
    if (error) {
      // Attached to the form as well as alerted, so the reason is still on
      // screen after the alert is dismissed and they try again. On `root`
      // rather than a field: which of the two was wrong is exactly what an
      // auth error must not disclose.
      setError('root', { message: error });
      Alert.alert('Could not sign in', error);
    }
  });

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 px-5 pb-6"
      >
        {/* Centred as one block. Two fields pinned to the top of a 956pt screen
            with the sign-up link pushed to the very bottom left ~500pt of dead
            canvas between them. */}
        <View className="flex-1 justify-center">
          <Text className="max-w-measure font-jk-xb text-display tracking-tight text-ink">
            Welcome back
          </Text>
          <Text className="mt-2 max-w-measure font-jk text-body text-muted">
            Use the email your estate invited.
          </Text>

          <View className="mt-7 gap-1">
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  label="Email"
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  // Moves to the password field instead of dismissing the
                  // keyboard. Focusing the next field blurs this one, which is
                  // what surfaces a bad address before a password has been
                  // typed for it. `submitBehavior` replaced `blurOnSubmit` in
                  // RN 0.79 — "submit" keeps the keyboard up for the handoff.
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

          {errors.root?.message ? <FormError>{errors.root.message}</FormError> : null}

          {/* Was a bare <Text>: it looked tappable and did nothing. Left visible
              but honest until password reset is wired — completing a reset needs
              a deep-link redirect target, which this app does not have yet. */}
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              Alert.alert(
                'Password reset',
                'Not available yet — ask your estate admin to reset it for you.',
              )
            }
            className="mt-3 h-9 justify-center self-end"
          >
            <Text className="font-jk-sb text-sub text-muted">Forgot password?</Text>
          </Pressable>

          <PrimaryButton
            title={isSubmitting ? 'Signing in…' : 'Log in'}
            onPress={() => void submit()}
            // isSubmitting is RHF's, and it stays true for the whole await — so
            // this is also the double-tap guard that stops two sign-in requests
            // racing on a slow connection.
            disabled={!isValid || isSubmitting}
            className="mt-4"
          />

          <Pressable
            onPress={() => router.push('/(auth)/sign-up')}
            className="mt-7 h-11 justify-center"
          >
            <Text className="text-center font-jk-sb text-sub text-muted">
              No account? <Text className="text-ink">Sign up</Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
