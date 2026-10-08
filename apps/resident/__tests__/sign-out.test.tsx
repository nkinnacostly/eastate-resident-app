/**
 * Signing out hands the phone back.
 *
 * REGRESSION: sign-out dropped the session and left this device's row in
 * push_tokens, so a shared or handed-over phone kept receiving the previous
 * resident's "your visitor has arrived" — for every visitor they ever had,
 * indefinitely. The row has to be deleted while there is still a session to
 * delete it AS, because RLS is what lets a user remove their own rows and
 * nobody else's.
 *
 * Driven through the real AuthProvider, push module and api module; only the
 * network edges (supabase-js, expo-notifications) are faked.
 */
import { act, render, waitFor } from '@testing-library/react-native';

import { AuthProvider, useAuth } from '@/lib/auth';
import { registerForPush } from '@/lib/push';

const TOKEN = 'ExponentPushToken[device-A]';

const mockSignOut = jest.fn();
const mockDelete = jest.fn();
const mockEq = jest.fn();
const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'push_tokens') {
        return {
          delete: () => {
            mockDelete();
            return { eq: (col: string, value: string) => mockEq(col, value) };
          },
        };
      }
      // The membership lookup the provider makes on mount. Its own filters are
      // own-rows.test.tsx's business; here it only has to answer.
      const q = {
        select: () => q,
        eq: () => q,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      };
      return q;
    },
    rpc: (...a: unknown[]) => mockRpc(...a),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: () => mockSignOut(),
    },
  },
}));

const mockPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetToken = jest.fn();
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => null,
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: () => mockPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetToken(...a),
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'project-1' } } } },
}));

let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return null;
}

const renderSignedIn = async () => {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(auth.membershipsLoaded).toBe(true));
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockSignOut.mockResolvedValue({ error: null });
  mockEq.mockResolvedValue({ error: null });
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockPermissions.mockResolvedValue({ status: 'granted', canAskAgain: true });
  mockGetToken.mockResolvedValue({ data: TOKEN });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('signing out', () => {
  beforeEach(async () => {
    // This launch registered the device, as the app does once an estate is known.
    await registerForPush('estate-1');
    expect(mockRpc).toHaveBeenCalledWith('register_push_token', expect.objectContaining({ p_token: TOKEN }));
  });

  it('deletes this device’s push token', async () => {
    await renderSignedIn();
    await act(() => auth.signOut());

    expect(mockDelete).toHaveBeenCalledTimes(1);
    // By TOKEN, never by user: signing out of one phone must not silence the
    // resident's other phone.
    expect(mockEq).toHaveBeenCalledWith('expo_push_token', TOKEN);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  // After sign-out there is no session, and RLS would let nobody delete it.
  it('deletes the token BEFORE the session is dropped', async () => {
    await renderSignedIn();
    await act(() => auth.signOut());

    expect(mockEq.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignOut.mock.invocationCallOrder[0],
    );
  });

  it('still signs out when the delete is refused', async () => {
    mockEq.mockResolvedValue({ error: { message: 'permission denied for table push_tokens' } });

    await renderSignedIn();
    await act(() => auth.signOut());

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  // Offline is the normal case for "I'm handing this phone back right now".
  it('still signs out when the delete cannot reach the server', async () => {
    mockEq.mockRejectedValue(new TypeError('Network request failed'));

    await renderSignedIn();
    await act(() => auth.signOut());

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  // A request that never answers is worse than one that fails: without a
  // ceiling the Sign out button would simply do nothing.
  it('does not wait forever on a delete that never answers', async () => {
    mockEq.mockReturnValue(new Promise(() => {}));

    await renderSignedIn();
    jest.useFakeTimers();

    let done = false;
    const pending = auth.signOut().then(() => {
      done = true;
    });
    await act(() => jest.advanceTimersByTimeAsync(3_000));
    expect(done).toBe(false);

    await act(() => jest.advanceTimersByTimeAsync(1_000));
    await pending;
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

/**
 * A launch where registerForPush never got as far as a token — offline at
 * startup, say — while a row from an EARLIER launch is still on the server.
 * A fresh copy of the push module, so no token is held from the tests above.
 */
describe('a launch that never registered', () => {
  const freshUnregister = () => {
    let fn!: () => Promise<void>;
    jest.isolateModules(() => {
      // A require, not an import: isolateModules only isolates what is loaded
      // inside its callback, and an import is hoisted out of it.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      fn = require('@/lib/push').unregisterForPush;
    });
    return fn;
  };

  it('looks the token up and deletes it', async () => {
    await freshUnregister()();

    expect(mockGetToken).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(mockEq).toHaveBeenCalledWith('expo_push_token', TOKEN);
  });

  // Sign-out is no moment to pop a permission dialog.
  it('never prompts for notification permission', async () => {
    mockPermissions.mockResolvedValue({ status: 'undetermined', canAskAgain: true });

    await freshUnregister()();

    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
    // No permission means this install never registered: nothing to take back.
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('does not throw when the token lookup itself fails', async () => {
    mockGetToken.mockRejectedValue(new Error('Expo push service unreachable'));

    await expect(freshUnregister()()).resolves.toBeUndefined();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
