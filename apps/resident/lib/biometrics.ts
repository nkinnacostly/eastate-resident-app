import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Biometric app lock — Face ID / fingerprint / device passcode.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * This is a LOCK, not a login. Biometrics cannot produce a Supabase session:
 * there is no credential to exchange, and the platform only ever tells us "the
 * person holding this phone is its owner". The session already persists in
 * LargeSecureStore and the app already opens straight to the codes screen — so
 * what this adds is a curtain in front of a session that was going to open
 * anyway.
 *
 * That framing decides the failure policy. Because the lock protects an
 * already-valid session rather than granting one, a resident who cannot pass it
 * must still have a way through: the device passcode fallback stays enabled,
 * and the lock screen always offers sign-out. An app that can be permanently
 * bricked by a cut finger is worse than one with no lock at all.
 *
 * Verified against the Expo SDK 54 docs for expo-local-authentication
 * (expo-local-authentication ~17.0.9, August 2026).
 */

/** Whether the resident has switched the lock on. Off until chosen. */
const KEY = 'biometric.lock.enabled.v1';

/**
 * How long the app may sit in the background before it re-locks.
 *
 * Zero would be hostile: tapping a code into WhatsApp to send to a visitor —
 * the app's single most common action — leaves and returns within seconds, and
 * a prompt on every return would train people to switch the lock off. Long
 * enough to survive that round trip, short enough that a phone left on a table
 * locks before anyone picks it up.
 */
export const LOCK_GRACE_MS = 60_000;

export interface BiometricCapability {
  /** Hardware exists AND something is enrolled — the only state worth offering. */
  available: boolean;
  /** Shapes the wording so we say "Face ID" rather than a generic "biometrics". */
  faceId: boolean;
  fingerprint: boolean;
}

/**
 * What this device can actually do.
 *
 * Hardware alone is not enough: a phone with a fingerprint sensor and no finger
 * enrolled will fail every authenticateAsync with `not_enrolled`. Both have to
 * be true before the toggle is worth showing.
 */
export async function getCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (!hasHardware || !enrolled) {
      return { available: false, faceId: false, fingerprint: false };
    }
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    return {
      available: true,
      faceId: types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION),
      fingerprint: types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT),
    };
  } catch {
    // Treat an unreadable capability as "no biometrics". Never a launch blocker.
    return { available: false, faceId: false, fingerprint: false };
  }
}

/** Human name for what this device offers, for buttons and prompts. */
export function methodLabel(cap: BiometricCapability): string {
  if (cap.faceId && cap.fingerprint) return 'biometrics';
  if (cap.faceId) return 'Face ID';
  if (cap.fingerprint) return 'fingerprint';
  return 'device unlock';
}

/** Is the lock switched on? Reads storage, so call it once at startup. */
export async function isLockEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === '1';
  } catch {
    // SecureStore is the source of truth for whether to lock. If it cannot be
    // read we must fail OPEN, not closed: failing closed on a storage error
    // would lock a resident out of an app they may never have enabled the lock
    // on, with no way to prove otherwise.
    return false;
  }
}

export async function setLockEnabled(on: boolean): Promise<void> {
  // SecureStore rather than AsyncStorage — unlike the onboarding flag, this
  // boolean decides whether a security control runs at all, and it should not
  // sit somewhere a debug tool can flip in one line.
  if (on) await SecureStore.setItemAsync(KEY, '1');
  else await SecureStore.deleteItemAsync(KEY);
}

export interface AuthOutcome {
  success: boolean;
  /** True when the platform will not accept further attempts for now. */
  lockedOut: boolean;
  /** True when the person dismissed the sheet themselves. */
  cancelled: boolean;
  error?: string;
}

/**
 * Run the prompt.
 *
 * `disableDeviceFallback` is deliberately left FALSE (its default). With it
 * true, a resident whose face is not recognised — a new beard, a dark room, a
 * cracked sensor — has no route into their own app but a reinstall. The device
 * passcode is the escape hatch that keeps this feature from becoming a trap,
 * and it is no weaker than the lock screen the phone already has.
 */
export async function authenticate(promptMessage: string): Promise<AuthOutcome> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      // iOS label for the passcode route. Naming it plainly matters: "Use
      // passcode" tells someone stuck at a failing scanner that a way through
      // exists, which the default wording does not.
      fallbackLabel: 'Use passcode',
      disableDeviceFallback: false,
    });

    if (res.success) return { success: true, lockedOut: false, cancelled: false };

    const error = 'error' in res ? String(res.error) : 'unknown';
    return {
      success: false,
      // `lockout` means too many failed attempts; the platform, not us, decides
      // when it clears. Worth distinguishing so the lock screen can tell the
      // person to wait rather than invite them to keep failing.
      //
      // Note `user_fallback` is NOT a lockout — it means they asked for the
      // passcode route. With disableDeviceFallback false the system handles
      // that itself and returns success, so it should rarely surface here;
      // treating it as a lockout would tell someone who just chose the working
      // escape hatch that they are locked out.
      lockedOut: error === 'lockout',
      cancelled: error === 'user_cancel' || error === 'system_cancel' || error === 'app_cancel',
      error,
    };
  } catch (e) {
    return { success: false, lockedOut: false, cancelled: false, error: String(e) };
  }
}
