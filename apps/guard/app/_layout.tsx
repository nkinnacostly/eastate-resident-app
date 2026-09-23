import '../global.css';

import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { ShiftProvider, useShift } from '@/lib/shift';

function Gate() {
  const { session, post, loading, mustChangePassword } = useShift();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    const onSetPassword = segments[1] === 'set-password';

    // No session OR no guard post means there is no shift to run. A signed-in
    // user who is not an active guard anywhere is sent back rather than shown
    // an empty keypad they cannot use.
    if ((!session || !post) && !inAuth) {
      router.replace('/(auth)/start-shift');
      return;
    }

    // Still on the password an admin generated and read out. Checked BEFORE
    // the route to the keypad, and only once the flag has actually resolved —
    // `null` means unknown, and routing on unknown would flash the keypad at
    // somebody who is about to be sent here anyway.
    if (session && mustChangePassword === true) {
      if (!onSetPassword) router.replace('/(auth)/set-password');
      return;
    }

    // Covers the moment the password is saved: the guard is standing on
    // set-password with the flag now false, and nothing else would move them.
    if (session && post && inAuth) router.replace('/(tabs)');
  }, [session, post, loading, mustChangePassword, segments, router]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#f7f9fb' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      {/* A verdict replaces the keypad rather than sliding over it: the guard
          has one decision to make and the only way out is the button that
          closes it. Fade, because there is no spatial "back" to imply. */}
      <Stack.Screen name="verdict" options={{ animation: 'fade', gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  if (!fontsLoaded) return <View className="flex-1 bg-canvas" />;

  return (
    <ShiftProvider>
      <Gate />
      <StatusBar style="dark" />
    </ShiftProvider>
  );
}
