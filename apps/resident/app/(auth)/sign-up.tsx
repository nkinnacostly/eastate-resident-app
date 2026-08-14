import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArrowLeft } from '@/components/icons';
import { Card, Input, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function SignUp() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    unit: '',
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.email.trim() || !form.password) {
      Alert.alert('Missing details', 'Email and password are required.');
      return;
    }
    setBusy(true);
    const { error } = await signUp({
      email: form.email.trim(),
      password: form.password,
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      unit: form.unit.trim(),
    });
    setBusy(false);
    if (error) {
      Alert.alert('Could not request access', error);
      return;
    }
    // The copy says "you can sign in now", so take them there rather than
    // leaving them on a filled-in form with no obvious next step.
    Alert.alert(
      'Request sent',
      'Your estate admin has to approve you before codes work. You can sign in now — codes appear once you are approved.',
      [{ text: 'Sign in', onPress: () => router.dismissTo('/(auth)/sign-in') }],
    );
  };

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

          <View className="mt-7 gap-3">
            <Input
              placeholder="Full name"
              autoComplete="name"
              value={form.fullName}
              onChangeText={set('fullName')}
            />
            <Input
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={form.email}
              onChangeText={set('email')}
            />
            <Input
              placeholder="Phone number"
              keyboardType="phone-pad"
              value={form.phone}
              onChangeText={set('phone')}
            />
            <Input placeholder="Unit number" value={form.unit} onChangeText={set('unit')} />
            <Input
              placeholder="Create password"
              secureTextEntry
              autoComplete="new-password"
              value={form.password}
              onChangeText={set('password')}
            />
          </View>

          <PrimaryButton
            title={busy ? 'Sending…' : 'Request access'}
            onPress={submit}
            disabled={busy}
            className="mt-5"
          />

          <Card className="mt-6 p-4">
            <Text className="font-jk text-sub text-muted">
              Estate admins see your name and unit only. Guards see neither until you issue a code.
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
