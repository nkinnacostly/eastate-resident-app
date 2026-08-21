import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArrowLeft } from '@/components/icons';
import { Card, Field, FormError, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { signUpSchema, type SignUpValues } from '@/lib/schemas';

export default function SignUp() {
  const { signUp } = useAuth();
  const router = useRouter();

  // The form is six fields on a scrolling screen, so each return key moves to
  // the next one. Without this the keyboard closes after every field and the
  // resident has to scroll and aim at the next input six times.
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const estateRef = useRef<TextInput>(null);
  const houseRef = useRef<TextInput>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isValid, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    mode: 'onTouched',
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      password: '',
      estateCode: '',
      houseCode: '',
    },
  });

  // Every value here is the PARSED one — trimmed by the schema. A trailing
  // space is a silent auth failure on the email and a no-match on either code,
  // so what the server sees is what the schema validated, not the raw field.
  const submit = handleSubmit(async (values) => {
    const res = await signUp(values);

    if (res.status === 'error') {
      setError('root', { message: res.message });
      Alert.alert('Could not create your account', res.message);
      return;
    }
    if (res.status === 'confirm_email') {
      // No session, so the request could not be made as them. Say so plainly
      // rather than implying an admin is already looking at it.
      Alert.alert(
        'Confirm your email',
        'Check your inbox, then sign in. We will ask for your two codes once more to finish joining.',
        [{ text: 'Sign in', onPress: () => router.dismissTo('/(auth)/sign-in') }],
      );
      return;
    }
    // status === 'requested': the account exists and they are signed in, so the
    // gate is already moving them to /join. That screen reports how the codes
    // landed — good or bad — via takeSignUpJoinResult. Navigating here too
    // would race it.
  });

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        {/* Outside the ScrollView so it stays put while the form scrolls.
            Reachable with no history (deep link), hence the canGoBack guard. */}
        <View className="px-5 pt-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(auth)/onboarding');
            }}
            className="h-11 w-11 items-center justify-center rounded-full bg-field"
          >
            <ArrowLeft color="#16181c" size={19} />
          </Pressable>
        </View>

        <ScrollView
          className="flex-1 px-5"
          contentContainerClassName="pb-6"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="mt-5 max-w-measure font-jk-xb text-display tracking-tight text-ink">
            Join your estate
          </Text>
          <Text className="mt-2 max-w-measure font-jk text-body text-muted">
            Your admin has to approve you before codes work.
          </Text>

          <View className="mt-7 gap-1">
            <Controller
              control={control}
              name="fullName"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  label="Full name"
                  placeholder="Full name"
                  autoComplete="name"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.fullName?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  ref={emailRef}
                  label="Email"
                  placeholder="Email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoComplete="email"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="phone"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  ref={phoneRef}
                  // Says out loud that it may be left blank. Without it the
                  // only way to discover the field is optional is to skip it
                  // and watch whether the button stays dim.
                  label="Phone number, optional"
                  placeholder="Phone number (optional)"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.phone?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  ref={passwordRef}
                  label="Create password"
                  placeholder="Create password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => estateRef.current?.focus()}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                />
              )}
            />
          </View>

          <Text className="mt-6 font-jk-xb text-label tracking-label text-muted">
            WHERE YOU LIVE
          </Text>
          <Text className="mt-2 max-w-measure font-jk text-sub text-muted">
            Two codes: one from your estate, one from your landlord. Neither works alone — a house
            code is only unique inside its own estate.
          </Text>

          <View className="mt-3 gap-1">
            {/* autoCapitalize + autoCorrect off: the codes are stored upper-case
                and autocorrect happily rewrites a 4-glyph code into a word.
                The SCHEMA still only checks presence — request_house_access
                normalises case and separators, so pre-judging the format here
                would refuse codes the estate actually issued. */}
            <Controller
              control={control}
              name="estateCode"
              render={({ field: { onChange, onBlur, value } }) => (
                <Field
                  ref={estateRef}
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
            // Dim until the whole form satisfies the schema. Creating half an
            // account is the one outcome this screen must not produce: a user
            // row with no join request attached is invisible to every admin.
            disabled={!isValid || isSubmitting}
            className="mt-5"
          />

          <Card className="mt-6 p-4">
            <Text className="font-jk text-sub text-muted">
              Estate admins see your name and house only. Guards see neither until you issue a
              code.
            </Text>
          </Card>

          {/* dismissTo, not push: coming from sign-in and pushing it again
              would stack sign-in → sign-up → sign-in without bound. This pops
              back to sign-in if it is already behind us, and replaces if not. */}
          <Pressable
            onPress={() => router.dismissTo('/(auth)/sign-in')}
            className="mt-7 h-11 justify-center"
          >
            <Text className="text-center font-jk-sb text-sub text-muted">
              Already have an account? <Text className="text-ink">Log in</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
