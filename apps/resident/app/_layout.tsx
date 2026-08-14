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
import Animated, { FadeOut } from 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/lib/auth';
import { CodesProvider } from '@/lib/codes';

/**
 * Routes between the signed-out stack and the tabs.
 *
 * Kept in one place rather than guarding each screen: a redirect scattered
 * across screens races itself on cold start, when `session` is briefly null
 * before the persisted session finishes decrypting.
 */
function Gate() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    if (!session && !inAuth) router.replace('/(auth)/onboarding');
    if (session && inAuth) router.replace('/(tabs)');
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <Animated.View
        exiting={FadeOut.duration(200)}
        className="flex-1 items-center justify-center bg-canvas"
      >
        <ActivityIndicator />
      </Animated.View>
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
      {/* The auth↔tabs swap is a router.replace, which has no direction to
          slide in — a cross-fade reads as a change of context rather than a
          hard cut. */}
      <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      {/* Modal, not card: the screen already closes with a ✕ rather than a
          back arrow, and modal presentation brings swipe-down-to-dismiss with
          it for free. */}
      <Stack.Screen
        name="code/[code]"
        options={{ presentation: 'modal', gestureEnabled: true }}
      />
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

  if (!fontsLoaded) {
    return <View className="flex-1 bg-canvas" />;
  }

  return (
    <AuthProvider>
      {/* Above the router, not inside (tabs): the code screen lives outside the
          tab group and needs the same list, and one source keeps the cap
          counter, the nav badge and the code screen from disagreeing. */}
      <CodesProvider>
        <Gate />
      </CodesProvider>
      <StatusBar style="dark" />
    </AuthProvider>
  );
}
