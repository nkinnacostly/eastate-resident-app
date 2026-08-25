import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArrowLeft } from '@/components/icons';
import { Field, FormError, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/lib/schemas';

/**
 * Step one of two: ask for a code.
 *
 * Deliberately does NOT say whether the address has an account, and the screen
 * is built around that rather than merely tolerating it. Both the copy here and
 * the endpoint behind it answer "if that address has an account, a code is on
 * its way" — anything sharper is a way for a stranger to test whether a given
 * person lives on the estate, which is exactly the fact this platform exists to
 * protect.
 *
 * The consequence to keep in mind when editing: there is no failure case to
 * render for "unknown address". The only errors that reach this screen are
 * transport ones.
 */
export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const router = useRouter();

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    mode: 'onTouched',
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const submit = handleSubmit(async ({ email }) => {
    const { error } = await requestPasswordReset(email);
    if (error) {
      setError('root', { message: error });
      return;
    }
    // The address travels to the next screen because verifyOtp needs BOTH the
    // code and the address it was minted for. Re-typing it there would be a
    // second chance to typo the one value that has to match.
    router.push({ pathname: '/(auth)/reset-password', params: { email } });
  });

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
            Reset your password
          </Text>
          <Text className="mt-2 max-w-measure font-jk text-body text-muted">
            Enter your email and we&rsquo;ll send you a code to choose a new password.
          </Text>

          <View className="mt-7">
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
                  returnKeyType="send"
                  onSubmitEditing={() => void submit()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                />
              )}
            />
          </View>

          {errors.root?.message ? <FormError>{errors.root.message}</FormError> : null}

          <PrimaryButton
            title={isSubmitting ? 'Sending…' : 'Send code'}
            onPress={() => void submit()}
            disabled={!isValid || isSubmitting}
            className="mt-4"
          />

          <Text className="mt-5 text-center font-jk text-micro text-muted">
            If that address has an account, the code arrives within a minute.
            It expires in an hour.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
