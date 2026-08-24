import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { LOCK_GRACE_MS, isLockEnabled, setLockEnabled } from './biometrics';

/**
 * Whether the app is currently behind the biometric lock.
 *
 * Kept out of the layout so the routing file stays about routing. The rules are
 * small but each one is load-bearing:
 *
 *  - The preference is resolved BEFORE the first paint and reported through
 *    `resolved`, which the splash waits on. Resolving it afterwards would let
 *    the codes screen paint and then drop a lock over it — the same flash the
 *    Stack.Protected guards exist to prevent, reintroduced by the very feature
 *    meant to protect that screen.
 *  - Locking is only ever applied to a SIGNED-IN app. Locking the sign-in
 *    screen protects nothing and strands anyone whose enrolment changed.
 *  - Re-locking is driven by TIME in the background, not by the mere fact of
 *    backgrounding. Sending a code to a visitor means leaving for WhatsApp and
 *    coming straight back; prompting on that round trip is how a lock gets
 *    switched off for good.
 */

/**
 * The preference, shared at module level rather than per-hook.
 *
 * It has to live outside React because two things read it that cannot see each
 * other's state: the AppState listener (registered once, and would otherwise
 * close over a stale value) and the settings toggle on another screen. Without
 * this, switching the lock on would not take effect until the next cold start —
 * the setting would appear to do nothing, which is the worst way for a security
 * control to fail.
 */
let enabledNow = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** Read the stored preference once at startup. */
async function loadPreference(): Promise<boolean> {
  enabledNow = await isLockEnabled();
  return enabledNow;
}

/** Current value, synchronously. Safe during render. */
export function lockEnabledNow(): boolean {
  return enabledNow;
}

/**
 * Change the preference from the settings screen.
 *
 * Writes storage, updates the shared value and wakes every subscriber, so a
 * toggle takes effect on the next background trip rather than the next launch.
 */
export async function applyLockPreference(on: boolean): Promise<void> {
  await setLockEnabled(on);
  enabledNow = on;
  notify();
}

export interface AppLock {
  /** True once we know whether to lock. The splash holds until this is true. */
  resolved: boolean;
  /** True while the lock screen should cover the app. */
  locked: boolean;
  unlock: () => void;
}

export function useAppLock(signedIn: boolean, authLoading: boolean): AppLock {
  const [resolved, setResolved] = useState(false);
  const [locked, setLocked] = useState(false);

  /** When the app last went to the background. Null while in the foreground. */
  const backgroundedAt = useRef<number | null>(null);

  /**
   * Make the startup decision once, and only after auth has settled.
   *
   * `authLoading` is the guard that makes this correct, and leaving it out was
   * a real bug: the preference is one boolean read, while restoring the session
   * means pulling an AES key out of SecureStore and decrypting the session blob
   * from AsyncStorage. The preference always won that race, so the lock decided
   * "not signed in, nothing to lock" and a cold start walked straight past it
   * into the codes screen with the lock switched on.
   *
   * Waiting for `authLoading` to clear also means `setLocked` and `setResolved`
   * land in the SAME batch. The splash holds on `resolved`, so the app is
   * revealed with the lock already in place — there is no frame in which the
   * codes screen is painted and then covered.
   *
   * Running only while `!resolved` is what stops it firing again later: a
   * resident who signs in with a password has just proved who they are, and
   * demanding a fingerprint on top of that would be a prompt for nothing.
   */
  useEffect(() => {
    if (authLoading || resolved) return;
    let cancelled = false;
    void loadPreference().then((on) => {
      if (cancelled) return;
      setLocked(on && signedIn);
      setResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, resolved, signedIn]);

  // Re-render when the toggle changes the shared value, so anything reading
  // `lockEnabledNow()` through this hook stays in step.
  useEffect(() => {
    const l = () => setResolved((r) => r);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  /**
   * Signing out must drop the lock.
   *
   * Without this, tapping "Sign out instead" on the lock screen would sign the
   * session away and leave the lock covering the sign-in screen — an app with
   * no route back in at all.
   */
  useEffect(() => {
    if (!signedIn) setLocked(false);
  }, [signedIn]);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        // `inactive` covers the iOS app switcher and an incoming call. Only
        // stamp the FIRST transition — iOS fires inactive→background on the way
        // out, and restamping would reset the grace period each time.
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
        return;
      }

      if (state === 'active') {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (!enabledNow || !signedIn || since === null) return;
        if (Date.now() - since >= LOCK_GRACE_MS) setLocked(true);
      }
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [signedIn]);

  const unlock = useCallback(() => {
    setLocked(false);
    // Clear the stamp so an unlock immediately followed by a background trip is
    // measured from that trip, not from before the unlock.
    backgroundedAt.current = null;
  }, []);

  return { resolved, locked, unlock };
}
