import '../global.css';

import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { BrandSplash } from '@/components/brand-splash';

import { AuthProvider, useAuth } from '@/lib/auth';
import { CodesProvider } from '@/lib/codes';
import { loadOnboardingSeen } from '@/lib/onboarding';
import { registerForPush } from '@/lib/push';

// Held until we know which stack to show. Without this the splash hands over to
// whatever the router mounts first, which is the very flash this is here to
// prevent.
void SplashScreen.preventAutoHideAsync();

/**
 * Routes between the signed-out stack, the join screen and the tabs.
 *
 * These are `Stack.Protected` guards rather than a `router.replace` in an
 * effect, and the difference is visible to the user. An effect runs *after* the
 * first render, so the router would mount its default route — `(tabs)`, i.e.
 * the code screen — paint it, and only then be told to go to onboarding. That
 * is exactly the flash of the code screen that used to precede onboarding on
 * every cold start. A guard removes the route from the navigator altogether, so
 * there is no frame in which it can be shown.
 *
 * The guards are mutually exclusive by construction: exactly one of them is
 * true for any (session, membershipsLoaded, memberships) triple.
 */
function Gate() {
  const { session, memberships, membershipsLoaded, activeEstateId } = useAuth();

  // Register for push once we know which estate this person is acting as.
  // Keyed on the estate: someone who lives at two estates needs a token
  // against each membership, or notifications for one of them go nowhere.
  useEffect(() => {
    if (activeEstateId) void registerForPush(activeEstateId);
  }, [activeEstateId]);

  const signedIn = !!session;
  // Until the membership query answers, a signed-in resident belongs to neither
  // the join screen nor the tabs. Routing on an empty list would send an
  // approved resident to "join an estate" on every cold start.
  const settled = signedIn && membershipsLoaded;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#f7f9fb' },
        animation: 'slide_from_right',
      }}
    >
      {/* The auth↔tabs swap has no direction to slide in — a cross-fade reads
          as a change of context rather than a hard cut. */}
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
      </Stack.Protected>

      {/* Signed in with no estate. Sign-up creates an account; a MEMBERSHIP is
          what an admin grants, so this is the normal state between the two. */}
      <Stack.Protected guard={settled && memberships.length === 0}>
        <Stack.Screen name="join" options={{ animation: 'fade' }} />
      </Stack.Protected>

      <Stack.Protected guard={settled && memberships.length > 0}>
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        {/* Modal, not card: the screen already closes with a ✕ rather than a
            back arrow, and modal presentation brings swipe-down-to-dismiss with
            it for free. */}
        <Stack.Screen
          name="code/[code]"
          options={{ presentation: 'modal', gestureEnabled: true }}
        />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * Holds the splash screen until every input to the routing decision is known.
 *
 * Fonts are in here too, not because routing needs them, but because handing
 * over to a screen whose text has no face yet produces a reflow the moment they
 * land — the splash is a better place to spend those milliseconds.
 */
function Shell() {
  const { loading } = useAuth();
  const [onboardingResolved, setOnboardingResolved] = useState(false);

  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    void loadOnboardingSeen().then(() => setOnboardingResolved(true));
  }, []);

  /**
   * A floor on how long the splash is shown.
   *
   * Everything it waits on can resolve in well under a frame on a warm start —
   * fonts cached, no session to decrypt — and a branded splash that appears for
   * 80ms is not branding, it is a flicker. 900ms is long enough to read the
   * mark and short enough not to feel like a load. It runs CONCURRENTLY with
   * the real work, so on a cold start it costs nothing at all.
   */
  const [minElapsed, setMinElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), 900);
    return () => clearTimeout(t);
  }, []);

  const ready = fontsLoaded && !loading && onboardingResolved && minElapsed;

  // Hand over from the native splash as soon as OUR splash has been laid out,
  // not when the app is ready. Waiting for `ready` would leave the bare system
  // splash up for the whole of startup and make the branded one flash past at
  // the end; this way the photograph is what the user actually sees while the
  // session and fonts resolve behind it.
  const onSplashLayout = useCallback(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <View className="flex-1 bg-ink">
      {ready ? (
        // Above the router, not inside (tabs): the code screen lives outside
        // the tab group and needs the same list, and one source keeps the cap
        // counter, the nav badge and the code screen from disagreeing.
        <CodesProvider>
          <Gate />
        </CodesProvider>
      ) : null}

      {/* Sits ON TOP and fades out, rather than being swapped for the app. A
          swap would show the first screen mid-mount; fading over it means the
          screen underneath is already settled by the time it is revealed. */}
      {!ready ? (
        <Animated.View
          exiting={FadeOut.duration(280)}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <BrandSplash onLayout={onSplashLayout} />
        </Animated.View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <Shell />
      <StatusBar style="dark" />
    </AuthProvider>
  );
}
