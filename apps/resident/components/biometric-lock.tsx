import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';

import {
  authenticate,
  getCapability,
  methodLabel,
  type BiometricCapability,
} from '@/lib/biometrics';

/**
 * The screen shown while the app is locked.
 *
 * Covers everything, including the tab bar, so nothing behind it is readable —
 * a lock that leaves the code list visible underneath has protected nothing.
 *
 * Two rules shape the whole component:
 *
 *  1. It always offers a way out. The prompt can be retried, and sign-out is
 *     always available. A resident whose face is not recognised must never be
 *     stuck staring at a screen with no working control.
 *  2. It never auto-prompts in a loop. The prompt fires once on mount and then
 *     only on an explicit tap. Re-firing on every dismissal produces a sheet
 *     that cannot be escaped, which on Android means the app has to be
 *     force-stopped.
 */
export function BiometricLock({
  onUnlock,
  onSignOut,
}: {
  onUnlock: () => void;
  onSignOut: () => void;
}) {
  const [cap, setCap] = useState<BiometricCapability | null>(null);
  const [status, setStatus] = useState<'idle' | 'prompting' | 'failed' | 'lockedOut'>('idle');

  // Guards against a second prompt racing the first. Two concurrent
  // authenticateAsync calls on Android cancel each other, so the user sees the
  // sheet flash open and shut.
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setStatus('prompting');

    const capability = cap ?? (await getCapability());
    if (!cap) setCap(capability);

    // The system sheet already names the method ("Face ID", the fingerprint
    // glyph), so the message says what is being unlocked rather than how.
    const res = await authenticate('Unlock My Estate Access');
    busy.current = false;

    if (res.success) {
      onUnlock();
      return;
    }
    setStatus(res.lockedOut ? 'lockedOut' : 'failed');
  }, [cap, onUnlock]);

  // Prompt once, on mount.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Re-prompt when the app comes back to the foreground.
   *
   * This is the iOS Face ID case specifically: backgrounding the app while the
   * sheet is up cancels it, so without this the resident returns to a dead lock
   * screen and has to find the button. Only fires when we are not already
   * prompting and not locked out by the platform.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !busy.current && status !== 'lockedOut') void run();
    });
    return () => sub.remove();
  }, [run, status]);

  const label = cap ? methodLabel(cap) : 'device unlock';

  return (
    <View className="flex-1 items-center justify-center bg-ink px-8">
      <Image
        source={require('@/assets/images/splash-icon.png')}
        style={{ width: 96, height: 96 }}
        contentFit="contain"
        accessible={false}
      />

      <Text className="mt-8 text-center font-jk-xb text-title tracking-tight text-canvas">
        {status === 'lockedOut' ? 'Too many attempts' : 'Locked'}
      </Text>

      <Text className="mt-3 text-center font-jk text-sub leading-[20px] text-white/60">
        {status === 'lockedOut'
          ? 'Your phone has paused unlocking for a moment. Wait a few seconds, then try again — or use your passcode.'
          : `Unlock with ${label} to see your codes.`}
      </Text>

      <Pressable
        onPress={() => void run()}
        disabled={status === 'prompting'}
        accessibilityRole="button"
        accessibilityLabel={`Unlock with ${label}`}
        className="mt-10 h-14 w-full items-center justify-center rounded-full bg-lime active:opacity-90 disabled:opacity-60"
      >
        <Text className="font-jk-xb text-body text-ink">
          {status === 'prompting' ? 'Waiting…' : 'Unlock'}
        </Text>
      </Pressable>

      {/* The escape hatch. Deliberately always present rather than revealed
          after N failures: someone who has changed phones, or whose enrolment
          was wiped, needs it on the first screen, not after failing three
          times to prove they are someone the sensor no longer recognises. */}
      <Pressable
        onPress={onSignOut}
        accessibilityRole="button"
        className="mt-5 h-11 items-center justify-center px-4"
      >
        <Text className="font-jk-sb text-sub text-white/50">Sign out instead</Text>
      </Pressable>
    </View>
  );
}
