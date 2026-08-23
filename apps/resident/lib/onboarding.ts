import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Whether this install has already been through the onboarding carousel.
 *
 * Deliberately NOT part of the session. Onboarding explains what the product
 * is, so it belongs to the device, not the account — a resident who signs out
 * has not forgotten what a visitor code is, and should land on sign-in rather
 * than be walked through the pitch again. Keeping it out of the session also
 * means it survives the token expiring.
 *
 * AsyncStorage rather than SecureStore: this is one boolean about which screens
 * a device has seen. Nothing here is worth a hardware-backed keystore slot, and
 * SecureStore reads are markedly slower — this one sits on the cold-start path,
 * ahead of the first paint.
 */
const KEY = 'onboarding.seen.v1';

/**
 * The value as it was when the app launched, held for the whole run.
 *
 * The routing decision reads this synchronously, and it must NOT change while
 * the app is open. If marking onboarding as seen also flipped this, the
 * carousel would be unmounted from under someone on the very tap that finishes
 * it — the router would drop the route they are standing on and bounce them to
 * sign-in instead of the sign-up screen "Get started" asked for. Writes go to
 * storage only; the next cold start picks them up.
 */
let seenAtStartup = false;

/** Resolve the flag once, before the first paint. */
export async function loadOnboardingSeen(): Promise<boolean> {
  try {
    seenAtStartup = (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    // Unreadable storage is not a reason to block launch. Showing onboarding
    // again is a mild annoyance; failing to start is not.
    seenAtStartup = false;
  }
  return seenAtStartup;
}

/** The startup value. Safe to call during render. */
export function seenOnboardingAtStartup(): boolean {
  return seenAtStartup;
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // Worst case they see the carousel once more next launch.
  }
}
