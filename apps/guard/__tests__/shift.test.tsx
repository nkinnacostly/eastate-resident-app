/**
 * The shift provider decides two things a gate depends on: whether this phone
 * may verify at all (the post), and what it leaves behind when a session ends
 * (the pool of live codes, and the push subscription).
 *
 * Driven through the real provider and the real push module. Only the edges
 * are stood in for -- the SQLite store, the sync loop and the Supabase client
 * -- and the Supabase stand-in answers in the shapes supabase-js 2.112 really
 * produces: a failed fetch is `{ data: null, error, status: 0 }`, not a throw.
 */
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { bindSession, clearPool, forgetPost, recallPost, rememberPost } from '@/lib/db';
import { unregisterForPush } from '@/lib/push';
import { ShiftProvider, useShift, type GuardPost } from '@/lib/shift';
import { syncNow } from '@/lib/sync';

type Cached = GuardPost & { user_id: string };

// Every side effect that has to happen in a particular ORDER lands here.
const mockLog: string[] = [];

const mockLocal = {
  cached: null as Cached | null,
  pushToken: null as string | null,
};

jest.mock('@/lib/db', () => ({
  bindSession: jest.fn(async () => false),
  clearPool: jest.fn(async () => {
    mockLog.push('clearPool');
  }),
  countLivePool: jest.fn(async () => 0),
  countStranded: jest.fn(async () => 0),
  countUnsynced: jest.fn(async () => 0),
  forgetPost: jest.fn(async () => {
    mockLog.push('forgetPost');
    mockLocal.cached = null;
  }),
  getMeta: jest.fn(async (k: string) => (k === 'push_token' ? mockLocal.pushToken : null)),
  setMeta: jest.fn(async () => {}),
  // Same contract as the real one: only ever the cached post of THIS user.
  recallPost: jest.fn(async (userId: string) =>
    mockLocal.cached?.user_id === userId ? mockLocal.cached : null,
  ),
  rememberPost: jest.fn(async (p: Cached) => {
    mockLocal.cached = p;
  }),
}));

jest.mock('@/lib/sync', () => ({
  syncNow: jest.fn(async () => ({ pushed: 0, collisions: 0, applied: 0 })),
}));

// push.ts installs its handler at import time. Not a device, so registration
// stops before asking for a token -- these tests are about removal.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  AndroidImportance: { MIN: 1 },
}));
jest.mock('expo-device', () => ({ isDevice: false }));

type Result = { data?: unknown; error: { message: string } | null; status?: number };

const mockServer = {
  session: null as unknown,
  sessionError: null as unknown,
  memberships: { data: [], error: null, status: 200 } as Result,
  retry: undefined as boolean | undefined,
  pushDelete: (_signal: AbortSignal | undefined): Promise<Result> =>
    Promise.resolve({ error: null }),
  deletes: [] as [string, unknown][],
  listener: null as null | ((event: string, session: unknown) => void),
};

/** A postgrest builder: chainable, and answers when awaited. */
const mockBuilder = (table: string) => {
  const filters: [string, unknown][] = [];
  let deleting = false;
  let signal: AbortSignal | undefined;
  const b: Record<string, unknown> = {
    select: () => b,
    order: () => b,
    limit: () => b,
    single: () => b,
    retry: (on: boolean) => {
      mockServer.retry = on;
      return b;
    },
    delete: () => {
      deleting = true;
      return b;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return b;
    },
    abortSignal: (s: AbortSignal) => {
      signal = s;
      return b;
    },
    then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => {
      let answer: Promise<unknown>;
      if (table === 'memberships') {
        answer = Promise.resolve(mockServer.memberships);
      } else if (table === 'profiles') {
        answer = Promise.resolve({ data: { must_change_password: false }, error: null });
      } else if (table === 'push_tokens' && deleting) {
        mockLog.push('deletePushToken');
        mockServer.deletes.push(...filters);
        answer = mockServer.pushDelete(signal);
      } else {
        answer = Promise.reject(new Error(`unexpected query on ${table}`));
      }
      return answer.then(ok, fail);
    },
  };
  return b;
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: mockServer.session },
        error: mockServer.sessionError,
      })),
      onAuthStateChange: jest.fn((cb: (event: string, session: unknown) => void) => {
        mockServer.listener = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      // Like auth-js: the local session is removed and SIGNED_OUT is emitted.
      signOut: jest.fn(async () => {
        mockLog.push('signOut');
        mockServer.listener?.('SIGNED_OUT', null);
        return { error: null };
      }),
    },
    from: jest.fn((table: string) => mockBuilder(table)),
    rpc: jest.fn(async (name: string) => {
      mockLog.push(`rpc:${name}`);
      return { data: [{ result: 'ok' }], error: null };
    }),
  },
}));

// ─── harness ─────────────────────────────────────────────────────────────────

const ACACIA: GuardPost = { membership_id: 'm-1', estate_id: 'e-1', estate_name: 'Acacia Park' };
const cachedFor = (userId: string): Cached => ({ user_id: userId, ...ACACIA });
const sessionFor = (userId: string) => ({ user: { id: userId }, access_token: 'jwt' });

const OFFLINE: Result = {
  data: null,
  error: { message: 'TypeError: Network request failed' },
  status: 0,
};
const NO_POST: Result = { data: [], error: null, status: 200 };
const CONFIRMED: Result = {
  data: [{ id: 'm-1', estate_id: 'e-1', created_at: '2026-09-01', estates: { name: 'Acacia Park' } }],
  error: null,
  status: 200,
};

let shift: ReturnType<typeof useShift>;
let postsSeen: (GuardPost | null)[] = [];

function Probe() {
  shift = useShift();
  postsSeen.push(shift.post);
  return null;
}

const mount = () =>
  render(
    <ShiftProvider>
      <Probe />
    </ShiftProvider>,
  );

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockLog.length = 0;
  postsSeen = [];
  mockLocal.cached = null;
  mockLocal.pushToken = null;
  mockServer.session = sessionFor('u-1');
  mockServer.sessionError = null;
  mockServer.memberships = CONFIRMED;
  mockServer.retry = undefined;
  mockServer.pushDelete = () => Promise.resolve({ error: null });
  mockServer.deletes = [];
  mockServer.listener = null;
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ─── the post ────────────────────────────────────────────────────────────────

describe('post resolution', () => {
  // The bug: any restart during an outage came up with no post, was routed to
  // sign-in, and sign-in needs the network. The offline pool sat on disk,
  // full, and the guard could not reach it.
  it('restores the cached post when the server cannot be reached', async () => {
    mockLocal.cached = cachedFor('u-1');
    mockServer.memberships = OFFLINE;

    mount();

    await waitFor(() => expect(shift.post).toEqual(ACACIA));
    // Bound before anything reads the pool, exactly as a server answer is.
    expect(bindSession).toHaveBeenCalledWith('e-1', 'm-1');
    // And the gate is live on it: the first sync runs against that post.
    await waitFor(() => expect(syncNow).toHaveBeenCalledWith('e-1', 'm-1'));
    expect(clearPool).not.toHaveBeenCalled();
  });

  // With a fallback in hand, postgrest's 1s + 2s + 4s of GET retries is seven
  // seconds of the sign-in screen for an answer that is not coming.
  it('does not wait out the retries when there is a cached post to use', async () => {
    mockLocal.cached = cachedFor('u-1');
    mockServer.memberships = OFFLINE;

    mount();

    await waitFor(() => expect(shift.post).toEqual(ACACIA));
    expect(mockServer.retry).toBe(false);
  });

  it('keeps the retries when there is nothing to fall back on', async () => {
    mount();

    await waitFor(() => expect(shift.post).toEqual(ACACIA));
    expect(mockServer.retry).toBe(true);
  });

  // The other half of the contract. An answer is not an error: the server
  // saying "not a guard here any more" is final, and the cache must not
  // override it -- not even for a render.
  it('does not fall back when the server answers that there is no post', async () => {
    mockLocal.cached = cachedFor('u-1');
    mockServer.memberships = NO_POST;

    mount();

    await waitFor(() => expect(forgetPost).toHaveBeenCalled());
    expect(shift.post).toBeNull();
    expect(postsSeen.every((p) => p === null)).toBe(true);
    expect(bindSession).not.toHaveBeenCalled();
    expect(mockLocal.cached).toBeNull();
  });

  // A shared gate phone: one guard's cached post must never open another
  // guard's session, even when the server cannot be asked.
  it('does not lend one guard\'s cached post to another', async () => {
    mockLocal.cached = cachedFor('u-1');
    mockServer.session = sessionFor('u-2');
    mockServer.memberships = OFFLINE;

    mount();

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[shift] could not resolve the post', expect.any(String)),
    );
    expect(recallPost).toHaveBeenCalledWith('u-2');
    expect(shift.post).toBeNull();
    expect(bindSession).not.toHaveBeenCalled();
  });

  it('remembers a post the server confirmed, under the guard it belongs to', async () => {
    mount();

    await waitFor(() => expect(shift.post).toEqual(ACACIA));
    expect(rememberPost).toHaveBeenCalledWith(cachedFor('u-1'));
  });

  // A restored post is provisional. It must keep asking, and a guard removed
  // during the outage loses it at the first answer -- not at the next token
  // refresh, up to an hour later.
  it('keeps asking, and drops a restored post the moment the server says no', async () => {
    mockLocal.cached = cachedFor('u-1');
    mockServer.memberships = OFFLINE;
    mount();
    await waitFor(() => expect(shift.post).toEqual(ACACIA));

    mockServer.memberships = NO_POST;
    await act(async () => {
      await shift.sync();
    });

    await waitFor(() => expect(shift.post).toBeNull());
    expect(clearPool).toHaveBeenCalled();
    expect(mockLocal.cached).toBeNull();
  });
});

// ─── nothing left behind ─────────────────────────────────────────────────────

describe('when the post or the session ends', () => {
  // Removed from the post while still signed in: nothing else would ever
  // clear the codes, because the session lives on.
  it('clears the pool and this device\'s push token when the guard is deactivated', async () => {
    mockLocal.pushToken = 'ExponentPushToken[gate-1]';
    mockServer.memberships = NO_POST;

    mount();

    await waitFor(() => expect(clearPool).toHaveBeenCalled());
    expect(forgetPost).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockServer.deletes).toEqual([['expo_push_token', 'ExponentPushToken[gate-1]']]),
    );
  });

  // A refresh token revoked by an admin ends the session without endShift.
  it('clears the pool on a SIGNED_OUT that did not come from endShift', async () => {
    mockLocal.cached = cachedFor('u-1');
    mount();
    await waitFor(() => expect(shift.post).toEqual(ACACIA));
    expect(clearPool).not.toHaveBeenCalled();

    act(() => mockServer.listener!('SIGNED_OUT', null));

    await waitFor(() => expect(clearPool).toHaveBeenCalled());
    expect(forgetPost).toHaveBeenCalled();
    await waitFor(() => expect(shift.post).toBeNull());
  });

  // The same revocation, discovered while the client was being built -- its
  // SIGNED_OUT fired before anything was listening.
  it('clears the pool at launch when no session survived', async () => {
    mockServer.session = null;

    mount();

    await waitFor(() => expect(clearPool).toHaveBeenCalled());
    expect(forgetPost).toHaveBeenCalled();
  });

  // An expired access token that could not be refreshed offline also reads
  // as "no session" -- but it is still on disk and returns with the signal.
  it('keeps the pool at launch when only the network stopped a refresh', async () => {
    mockServer.session = null;
    mockServer.sessionError = new AuthRetryableFetchError('Failed to fetch', 0);

    mount();

    await waitFor(() => expect(shift.loading).toBe(false));
    await act(async () => {});
    expect(clearPool).not.toHaveBeenCalled();
  });

  it('keeps the pool through an ordinary launch', async () => {
    mount();

    await waitFor(() => expect(shift.post).toEqual(ACACIA));
    expect(clearPool).not.toHaveBeenCalled();
  });
});

// ─── push token ──────────────────────────────────────────────────────────────

describe('ending a shift', () => {
  const endShift = async () => {
    mount();
    await waitFor(() => expect(shift.post).toEqual(ACACIA));
    await act(async () => {
      await shift.endShift();
    });
  };

  // The bug: the row outlived the session, so a phone handed to the next
  // guard kept receiving the previous guard's pushes.
  it('removes this device\'s push token before the session is dropped', async () => {
    mockLocal.pushToken = 'ExponentPushToken[gate-1]';

    await endShift();

    expect(mockServer.deletes).toEqual([['expo_push_token', 'ExponentPushToken[gate-1]']]);
    // RLS checks the delete against auth.uid(); after signOut there is none.
    expect(mockLog.indexOf('deletePushToken')).toBeLessThan(mockLog.indexOf('signOut'));
    expect(mockLog.indexOf('clearPool')).toBeLessThan(mockLog.indexOf('signOut'));
    expect(forgetPost).toHaveBeenCalled();
  });

  it('still signs out when the server refuses the delete', async () => {
    mockLocal.pushToken = 'ExponentPushToken[gate-1]';
    mockServer.pushDelete = () => Promise.resolve({ error: { message: 'permission denied' } });

    await endShift();

    expect(mockLog).toContain('signOut');
    expect(clearPool).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[push] could not remove this device token', expect.any(Error));
  });

  it('still signs out when the delete throws', async () => {
    mockLocal.pushToken = 'ExponentPushToken[gate-1]';
    mockServer.pushDelete = () => Promise.reject(new TypeError('Network request failed'));

    await endShift();

    expect(mockLog).toContain('signOut');
    expect(clearPool).toHaveBeenCalled();
  });

  it('skips the delete when this device never registered', async () => {
    await endShift();

    expect(mockServer.deletes).toEqual([]);
    expect(mockLog).toContain('signOut');
  });
});

describe('unregisterForPush', () => {
  // A gate with a dead uplink can hold a request open for minutes. The
  // delete is bounded so it can never be the reason a shift did not end.
  it('gives up on a delete that never answers', async () => {
    jest.useFakeTimers();
    mockLocal.pushToken = 'ExponentPushToken[gate-1]';
    // Behaves as postgrest does: silent until aborted, then an error result.
    mockServer.pushDelete = (signal) =>
      new Promise((resolve) =>
        signal?.addEventListener('abort', () =>
          resolve({ error: { message: 'AbortError: Aborted' } }),
        ),
      );

    let settled = false;
    void unregisterForPush().then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});
