import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Input, PrimaryButton } from '@/components/ui';
import { useShift } from '@/lib/shift';

export default function StartShift() {
  const { signIn, session, post } = useShift();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) Alert.alert('Could not start shift', error);
    // On success the Gate redirects once a guard post resolves.
  };

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

          <View className="mt-7 gap-3">
            <Input
              placeholder="you@estate.co.za"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Input
              placeholder="Password"
              secureTextEntry
              autoComplete="current-password"
              value={password}
              onChangeText={setPassword}
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
            title={busy ? 'Signing in…' : 'Sign in and sync'}
            onPress={submit}
            disabled={busy}
            className="mt-5"
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
