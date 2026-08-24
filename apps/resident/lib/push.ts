import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushToken } from './api';

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
    await registerPushToken(estateId, token);
  } catch (e) {
    // Never let this break a launch. The app works without notifications.
    console.warn('[push] registration failed', e);
  }
}
