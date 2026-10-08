import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getMeta, setMeta } from './db';
import { supabase } from './supabase';

/**
 * Device registration for push notifications — guard side.
 *
 * The guard receives a different KIND of notification from the resident, and
 * the difference is the reason this file exists rather than sharing the
 * resident's.
 *
 * A resident gets news: "a guard is on duty", "your visitor arrived". A guard
 * gets a `forced_pull` — a DATA-ONLY message telling the device its offline
 * pool is stale and should be re-pulled now rather than at the next scheduled
 * interval. It is how a revocation reaches a gate faster than the pull loop
 * would manage on its own (Technical Design §5.4).
 *
 * That shapes everything below: a guard is watching a gate, not a phone, so
 * nothing here may produce a banner, a sound, or a badge. A notification that
 * interrupts the person verifying codes is a regression, not a feature.
 *
 * Like the resident's, none of this is load-bearing. `forced_pull` only makes
 * the pool fresher sooner; the periodic pull still runs, and a stale pool
 * still admits by design — refusing to verify on stale data would turn a
 * network outage into a gate outage.
 */

/**
 * Silent by design.
 *
 * The resident app sets `shouldShowBanner: true` here. The guard must not:
 * every message it receives is machinery, and surfacing it would put a popup
 * over the verification screen at the exact moment a visitor is waiting.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * The EAS project id, which `getExpoPushTokenAsync` requires.
 *
 * The guard app has its OWN EAS project, separate from the resident's — so
 * this reads the guard's app.json, and the FCM credentials have to be uploaded
 * to both projects independently. Uploading to one does not cover the other.
 */
function easProjectId(): string | null {
  const id =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

const PUSH_TOKEN_KEY = 'push_token';

/**
 * How long sign-out will wait on the server to forget this device. A gate with
 * a dead uplink can hold a request open far longer than a guard will stand
 * looking at a spinner, and this is the one step of ending a shift that must
 * never be the reason it did not end.
 */
const UNREGISTER_TIMEOUT_MS = 5_000;

/**
 * Ask for permission, get an Expo push token, and store it against the guard
 * membership. Safe to call on every launch: `register_push_token` upserts on
 * (membership, token).
 */
export async function registerForPush(estateId: string): Promise<void> {
  try {
    // A simulator has no push service to register with, and asking produces a
    // confusing failure rather than a token.
    if (!Device.isDevice) return;

    if (Platform.OS === 'android') {
      // Android 8+ drops any notification with no channel, data-only included.
      //
      // MIN importance, no vibration: this channel carries sync wake-ups, and
      // the setting is what a guard sees if they ever open the app's
      // notification settings. It should read as plumbing, because it is.
      await Notifications.setNotificationChannelAsync('sync', {
        name: 'Gate data sync',
        importance: Notifications.AndroidImportance.MIN,
        vibrationPattern: [0],
        showBadge: false,
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

    // Remembered BEFORE the RPC, and on disk rather than in memory, because
    // sign-out has to find it again -- possibly after a restart, possibly
    // offline, and never by asking Expo's servers for it a second time. If the
    // RPC below fails there is no row to remove, and removing nothing is fine.
    await setMeta(PUSH_TOKEN_KEY, token);

    // `p_role: 'guard'` is the part that differs from the resident call. The
    // RPC resolves the membership from auth.uid() + estate + role, so a token
    // registered under the wrong role would be attached to the wrong
    // membership — or to none, if this person is not a guard here.
    const { error } = await supabase.rpc('register_push_token', {
      p_estate_id: estateId,
      p_role: 'guard',
      p_token: token,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    // Never let this break a shift. Verification works without notifications.
    console.warn('[push] registration failed', e);
  }
}

/**
 * Stop this device receiving pushes for whoever is signed in. Call BEFORE the
 * session is dropped.
 *
 * Nothing removed these rows, so a gate phone handed to the next guard kept
 * receiving the previous guard's pushes for as long as their membership lived:
 * register_push_token adds a row per (membership, token), sign-out left it, and
 * the dispatcher kept addressing it. The phone is shared; the subscription was
 * not supposed to be.
 *
 * Deleted directly, by token, under RLS: "push_tokens: manage own" lets a user
 * delete rows on their OWN memberships and nobody else's, so this removes
 * exactly this device's rows for this person -- not the token on another
 * guard's membership, and not this person's other devices. Hence it has to run
 * while there is still a session to be that person.
 *
 * Best effort, and never throws. A row left behind costs a misdirected
 * data-only wake-up; a sign-out blocked on the network costs a guard who
 * cannot hand over the phone.
 */
export async function unregisterForPush(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UNREGISTER_TIMEOUT_MS);
  try {
    const token = await getMeta(PUSH_TOKEN_KEY);
    if (!token) return;
    const { error } = await supabase
      .from('push_tokens')
      .delete()
      .eq('expo_push_token', token)
      .abortSignal(controller.signal);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn('[push] could not remove this device token', e);
  } finally {
    clearTimeout(timer);
  }
}
