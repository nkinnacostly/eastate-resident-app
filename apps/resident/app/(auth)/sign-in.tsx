import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Input, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function SignIn() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    // On success the Gate in app/_layout redirects — nothing to do here.
    if (error) Alert.alert('Could not sign in', error);
  };

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

        <View className="mt-7 gap-3">
          <Input
            placeholder="you@example.com"
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
          title={busy ? 'Signing in…' : 'Log in'}
          onPress={submit}
          disabled={busy}
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
