import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushToken, unregisterPushToken } from './api';

/**
 * Device registration for push notifications.
 *
 * Two notifications reach a resident: "your visitor has arrived" when a code is
 * burned at the gate, and "a guard is on duty" when a shift opens. Both are
 * enqueued in Postgres inside the transaction that caused them and delivered by
 * the `dispatch-notifications` Edge Function on a one-minute cron.
 *
 * Nothing here is load-bearing. A resident who declines notifications, or whose
 * token never registers, still sees who is on duty on the codes screen and
 * still sees their code history — the push is a nudge, never the only route to
 * a fact. So every failure below is swallowed and logged rather than surfaced.
 */

// Foreground behaviour. Without this a notification arriving while the app is
// open is silently dropped on iOS, which reads as "the feature is broken".
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * The EAS project id, which `getExpoPushTokenAsync` requires.
 *
 * Expo resolves this from app.json's `extra.eas.projectId`, written by
 * `eas init`. It is genuinely absent in this project — so this returns null,
 * registration is skipped, and the reason is logged rather than throwing an
 * opaque error deep inside the SDK.
 */
function easProjectId(): string | null {
  const id =
    Constants.expoConfig?.extra?.eas?.projectId ??
    // Older/newer manifest shapes keep it here.
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * The Expo token this device last registered, kept so sign-out can name the row
 * to delete without another round trip to Expo. A property of the install, not
 * of the person signed in, so it is not cleared when they sign out — the next
 * resident on this phone registers the very same token.
 */
let registeredToken: string | null = null;

/**
 * How long sign-out waits for the token delete before going ahead without it.
 *
 * Sign-out is how a resident hands a phone over, and it must work on a dead
 * network: the session is dropped locally either way, so a delete that cannot
 * land must not hold the resident on screen. Long enough for a slow round
 * trip, short enough that a tap on "Sign out" still feels like it did something.
 */
const UNREGISTER_TIMEOUT_MS = 4000;

/**
 * Ask for permission, get an Expo push token, and store it against the
 * membership. Safe to call on every launch: `register_push_token` upserts on
 * (membership, token).
 */
export async function registerForPush(estateId: string): Promise<void> {
  try {
    // A simulator has no push service to register with, and asking produces a
    // confusing failure rather than a token.
    if (!Device.isDevice) return;

    if (Platform.OS === 'android') {
      // Android 8+ drops any notification that has no channel. Creating it
      // before requesting permission means the very first push has somewhere
      // to land.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Gate activity',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      // Only ask if we have not been refused outright — repeatedly prompting a
      // person who said no is how an app gets its notifications disabled at
      // the OS level.
      if (!existing.canAskAgain) return;
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    const projectId = easProjectId();
    if (!projectId) {
      console.warn(
        '[push] no EAS projectId in app.json (extra.eas.projectId) — ' +
          'run `eas init`. Skipping token registration.',
      );
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    // Held before the RPC, not after: if the RPC lands but its answer is lost,
    // the row exists, and sign-out still has to be able to name it.
    registeredToken = token;
    await registerPushToken(estateId, token);
  } catch (e) {
    // Never let this break a launch. The app works without notifications.
    console.warn('[push] registration failed', e);
  }
}

/**
 * This device's Expo token WITHOUT ever prompting — for sign-out on a launch
 * where registerForPush did not get as far as fetching one (it was offline at
 * startup, say, while a row from an earlier launch is still on the server).
 * No permission means this install never registered, so there is nothing to
 * take back.
 */
async function tokenWithoutPrompting(): Promise<string | null> {
  if (registeredToken) return registeredToken;
  if (!Device.isDevice) return null;
  if ((await Notifications.getPermissionsAsync()).status !== 'granted') return null;
  const projectId = easProjectId();
  if (!projectId) return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/**
 * Take this device's token back from the signed-in user, so the NEXT person to
 * use the phone does not receive the last one's "your visitor has arrived".
 *
 * MUST run before the session is dropped: the delete goes through RLS as this
 * user, and once signed out there is nobody left with the right to remove the
 * row. Without it a shared or handed-over phone kept buzzing for the previous
 * resident's visitors indefinitely.
 *
 * Best effort, like registration, and it never throws. A failed or slow delete
 * must never stop someone signing out — that would be the worse failure — so
 * it gives up after UNREGISTER_TIMEOUT_MS and lets sign-out carry on.
 */
export async function unregisterForPush(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = (async () => {
    const token = await tokenWithoutPrompting();
    if (token) await unregisterPushToken(token);
  })();
  const giveUp = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), UNREGISTER_TIMEOUT_MS);
  });

  try {
    if ((await Promise.race([attempt, giveUp])) === 'timeout') {
      console.warn('[push] token removal timed out; signing out without it');
    }
  } catch (e) {
    console.warn('[push] token removal failed; signing out without it', e);
  } finally {
    clearTimeout(timer);
  }
}
