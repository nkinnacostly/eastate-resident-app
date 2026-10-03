import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from './auth';
import { useAuth, type PasswordResetResult } from './auth-context';
import { supabase } from './supabase';

afterEach(cleanup);

// ─── A stand-in Supabase client ──────────────────────────────────────────────
//
// Only the auth surface matters here. Every table/RPC read the provider makes
// once signed in resolves to "nothing", which is enough for it to settle.

// vi.mock is hoisted above every import and declaration, so everything its
// factory touches has to be created in vi.hoisted.
const { state, auth, chain, fakeSession } = vi.hoisted(() => {
  type Listener = (event: string, session: unknown) => void;
  const state = { listener: null as null | Listener, current: null as unknown };
  const fakeSession = { user: { id: 'user-1', email: 'admin@example.com' }, access_token: 't' };
  const chain = (): unknown => {
    const done = Promise.resolve({ data: [], error: null });
    return new Proxy(() => {}, {
      get: (_t, prop) => (prop === 'then' ? done.then.bind(done) : () => chain()),
    });
  };
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: state.current } })),
    onAuthStateChange: vi.fn((cb: Listener) => {
      state.listener = cb;
      return { data: { subscription: { unsubscribe: () => {} } } };
    }),
    verifyOtp: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(async () => {
      state.current = null;
      state.listener?.('SIGNED_OUT', null);
      return { error: null };
    }),
    signInWithPassword: vi.fn(),
  };
  return { state, auth, chain, fakeSession };
});

vi.mock('./supabase', () => ({
  supabase: {
    auth,
    from: () => chain(),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) },
  },
}));

/** Redeeming the code is a sign-in: Supabase announces the session at once. */
function codeAccepted() {
  auth.verifyOtp.mockImplementation(async () => {
    state.current = fakeSession;
    state.listener?.('SIGNED_IN', fakeSession);
    return { data: { session: fakeSession }, error: null };
  });
}

let result: PasswordResetResult | null = null;

function Probe() {
  const { session, completePasswordReset, requestPasswordReset } = useAuth();
  return (
    <>
      <output data-testid="session">{session ? 'signed in' : 'signed out'}</output>
      <button
        type="button"
        onClick={() => {
          void completePasswordReset('admin@example.com', '123456', 'new-password-1').then((r) => {
            result = r;
          });
        }}
      >
        reset
      </button>
      <button
        type="button"
        onClick={() => {
          void requestPasswordReset('admin@example.com').then((r) => {
            result = { status: 'error', message: String(r.error) };
          });
        }}
      >
        request
      </button>
    </>
  );
}

async function renderProvider() {
  render(<AuthProvider><Probe /></AuthProvider>);
  await act(async () => {});
}

const session = () => screen.getByTestId('session').textContent;
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  vi.clearAllMocks();
  state.current = null;
  state.listener = null;
  result = null;
});

describe('password reset on the dashboard', () => {
  // ★ The property this exists for.
  it('holds the session back until the new password is actually saved', async () => {
    codeAccepted();
    let save!: (v: { error: null }) => void;
    auth.updateUser.mockImplementation(() => new Promise((r) => { save = r; }));
    await renderProvider();

    await act(async () => { screen.getByText('reset').click(); });
    await flush();
    // The code has been accepted and Supabase has announced a session...
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'admin@example.com', token: '123456', type: 'recovery' });
    // ...but the app must not treat that as signed in yet.
    expect(session()).toBe('signed out');

    await act(async () => { save({ error: null }); });
    await flush();
    expect(session()).toBe('signed in');
    expect(result).toEqual({ status: 'ok' });
    expect(supabase.rpc).toHaveBeenCalledWith('clear_must_change_password');
  });

  it('signs out instead of signing in when saving the password fails', async () => {
    codeAccepted();
    auth.updateUser.mockResolvedValue({ error: { message: 'Password is too weak' } });
    await renderProvider();

    await act(async () => { screen.getByText('reset').click(); });
    await flush();
    expect(auth.signOut).toHaveBeenCalled();
    expect(session()).toBe('signed out');
    expect(result).toEqual({ status: 'error', message: 'Password is too weak' });
  });

  it('reports a wrong or expired code without touching the password', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: { message: 'Token has expired or is invalid' } });
    await renderProvider();

    await act(async () => { screen.getByText('reset').click(); });
    await flush();
    expect(result).toEqual({ status: 'bad_code' });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(session()).toBe('signed out');
  });

  it('lets a normal sign-in through afterwards (the hold is always released)', async () => {
    auth.verifyOtp.mockResolvedValue({ data: {}, error: { message: 'expired' } });
    await renderProvider();
    await act(async () => { screen.getByText('reset').click(); });
    await flush();

    await act(async () => { state.listener?.('SIGNED_IN', fakeSession); });
    expect(session()).toBe('signed in');
  });

  it('asks our own function for the code, and says nothing about whether the account exists', async () => {
    await renderProvider();
    await act(async () => { screen.getByText('request').click(); });
    await flush();
    expect(supabase.functions.invoke).toHaveBeenCalledWith('request-password-reset', {
      body: { email: 'admin@example.com' },
    });
    expect(result).toEqual({ status: 'error', message: 'null' }); // no error

    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: new Error('boom') } as never);
    await act(async () => { screen.getByText('request').click(); });
    await flush();
    expect(result).toEqual({ status: 'error', message: 'We could not send a code just now. Please try again.' });
  });
});
