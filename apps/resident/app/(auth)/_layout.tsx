import { Stack } from 'expo-router';

import { seenOnboardingAtStartup } from '@/lib/onboarding';

export default function AuthLayout() {
  // Read once, at startup, and deliberately not reactive — see the note on
  // `seenAtStartup` in lib/onboarding. The value decides which screen this
  // stack opens on, and a stack cannot have the ground moved under it while
  // someone is standing on it.
  const seen = seenOnboardingAtStartup();

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f7f9fb' } }}
    >
      {/*
        Order is the routing decision here: the first screen declared is the one
        this stack opens on. Onboarding is what the product is, not who you are,
        so it plays once per install — someone who has signed out has not
        forgotten what a visitor code is, and lands on sign-in instead.

        Guarding rather than reordering also keeps onboarding unreachable
        afterwards, so a stray `router.push('/(auth)/onboarding')` cannot put a
        returning resident back at the start of the pitch.
      */}
      <Stack.Protected guard={!seen}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      {/* Both reset screens live in this stack, not behind the gate, because
          the whole point is that the person using them cannot sign in. */}
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="reset-password" />
      {/* Same reasoning: an unconfirmed account has no session, so this belongs
          on the signed-out side even though it is the tail of sign-up. */}
      <Stack.Screen name="verify-email" />
    </Stack>
  );
}
