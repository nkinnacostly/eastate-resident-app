/**
 * Invitations to work a gate, as a signed-in user with no post sees them.
 *
 * Typing an existing account's email into the dashboard used to make that
 * person a guard without asking them. It now files an invitation, and this
 * screen is the only place the person can accept it -- so a broken Accept is
 * a guard who can never start a shift, and a careless one is a guard who was
 * never asked.
 *
 * Driven through the real start-shift screen and the real lib/invites. Only
 * the Supabase client and the shift context are stood in for, and the client
 * answers in the shapes supabase-js really produces: a failed call is
 * `{ data: null, error }`, not a throw.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import StartShift from '@/app/(auth)/start-shift';
import type { GuardInvite } from '@/lib/invites';

type Result = { data: unknown; error: { message: string } | null };

const ACACIA: GuardInvite = {
  invite_id: 'inv-1',
  estate_id: 'e-1',
  estate_name: 'Acacia Park',
  invited_at: '2026-10-08T08:00:00Z',
};
const BAOBAB: GuardInvite = {
  invite_id: 'inv-2',
  estate_id: 'e-2',
  estate_name: 'Baobab Close',
  invited_at: '2026-10-08T09:00:00Z',
};

const mockServer = {
  invites: [] as GuardInvite[],
  listError: null as string | null,
  answer: (_inviteId: string, _accept: boolean): Result | Promise<Result> => ({
    data: 'declined',
    error: null,
  }),
};

const mockRpc = jest.fn(async (name: string, args?: Record<string, unknown>): Promise<Result> => {
  if (name === 'my_guard_invites') {
    return mockServer.listError
      ? { data: null, error: { message: mockServer.listError } }
      : { data: [...mockServer.invites], error: null };
  }
  if (name === 'respond_to_guard_invite') {
    return mockServer.answer(args?.p_invite_id as string, args?.p_accept as boolean);
  }
  throw new Error(`unexpected rpc ${name}`);
});
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: [string, Record<string, unknown>?]) => mockRpc(...a) },
}));

// A signed-in user who is not a guard anywhere: the state the Gate holds on
// start-shift, and the only one an invitation can be answered from.
const mockShift = {
  session: null as unknown,
  post: null as unknown,
  online: true,
  recheckPost: jest.fn(),
  signIn: jest.fn(async () => ({ error: null as string | null })),
};
jest.mock('@/lib/shift', () => ({ useShift: () => mockShift }));

const NOTICE = /not an active guard at any estate/;
const invitation = (estate: string) => `${estate} invited you to work the gate`;
const button = (name: string) => screen.getByRole('button', { name });
const listed = () => mockRpc.mock.calls.filter(([name]) => name === 'my_guard_invites').length;
const answers = () =>
  mockRpc.mock.calls.filter(([name]) => name === 'respond_to_guard_invite').map(([, a]) => a);

beforeEach(() => {
  jest.clearAllMocks();
  mockServer.invites = [];
  mockServer.listError = null;
  mockServer.answer = () => ({ data: 'declined', error: null });
  mockShift.session = { user: { id: 'u-1', email: 'thabo@example.com' } };
  mockShift.post = null;
  mockShift.online = true;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('with nothing pending', () => {
  it('is the screen it always was: the plain notice and the form, nothing to answer', async () => {
    render(<StartShift />);
    await waitFor(() => expect(listed()).toBe(1));
    await act(async () => {});

    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Decline/ })).toBeNull();
    expect(screen.queryByText(/Could not check/)).toBeNull();
    expect(button('Sign in and sync')).toBeTruthy();
  });

  // Nobody to ask on behalf of. my_guard_invites reads the user from the
  // session, so for a signed-out phone it could only fail.
  it('does not ask the server while nobody is signed in', async () => {
    mockShift.session = null;
    render(<StartShift />);
    await act(async () => {});

    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  // "None" and "could not ask" must not read the same. The second is a phone
  // at a gate with no signal and an invitation it cannot see yet.
  it('says it could not check, rather than that there is nothing, and can ask again', async () => {
    mockServer.listError = 'TypeError: Network request failed';
    render(<StartShift />);

    expect(await screen.findByText(/Could not check for invitations/)).toBeTruthy();
    expect(screen.getByText(NOTICE)).toBeTruthy();

    mockServer.listError = null;
    mockServer.invites = [ACACIA];
    fireEvent.press(screen.getByText('Check again'));

    expect(await screen.findByText(invitation('Acacia Park'))).toBeTruthy();
  });
});

describe('with invitations pending', () => {
  it('offers each one with its own Accept and Decline, in place of the dead end', async () => {
    mockServer.invites = [ACACIA, BAOBAB];
    render(<StartShift />);

    expect(await screen.findByText(invitation('Acacia Park'))).toBeTruthy();
    expect(screen.getByText(invitation('Baobab Close'))).toBeTruthy();
    for (const estate of ['Acacia Park', 'Baobab Close']) {
      expect(button(`Accept ${estate}`)).toBeEnabled();
      expect(button(`Decline ${estate}`)).toBeEnabled();
    }
    // "An admin has to assign you" is not true of somebody holding an invitation.
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  // The point of the feature for the guard: accepting has to land them on the
  // keypad. Their session does not change, so unless the post is asked for
  // again they would sit here, a guard with no way to start a shift.
  it('accepts, then asks for the post again so the Gate can move them on', async () => {
    mockServer.invites = [ACACIA];
    mockServer.answer = () => ({ data: 'accepted', error: null });
    render(<StartShift />);

    fireEvent.press(await screen.findByRole('button', { name: 'Accept Acacia Park' }));

    await waitFor(() => expect(mockShift.recheckPost).toHaveBeenCalledTimes(1));
    expect(answers()).toEqual([{ p_invite_id: 'inv-1', p_accept: true }]);
    expect(await screen.findByText(/now a guard at Acacia Park/)).toBeTruthy();
  });

  // If the post does not resolve -- the signal went as the answer landed --
  // the guard needs a way to ask again that is not "sign out and back in".
  it('lets the guard ask for the post again if it has not arrived', async () => {
    mockServer.invites = [ACACIA];
    mockServer.answer = () => ({ data: 'accepted', error: null });
    render(<StartShift />);
    fireEvent.press(await screen.findByRole('button', { name: 'Accept Acacia Park' }));
    await screen.findByText(/now a guard at Acacia Park/);

    fireEvent.press(screen.getByText('Try again'));

    expect(mockShift.recheckPost).toHaveBeenCalledTimes(2);
  });

  it('declines, and takes only that invitation off the screen', async () => {
    mockServer.invites = [ACACIA, BAOBAB];
    render(<StartShift />);

    fireEvent.press(await screen.findByRole('button', { name: 'Decline Acacia Park' }));

    // Not waitFor(...toBeNull()): every failed poll of that pretty-prints the
    // element's whole fiber graph, about a second each, and the default
    // timeout expires after two polls -- a test that fails on a slow machine
    // for no reason in the code.
    await waitForElementToBeRemoved(() => screen.getByText(invitation('Acacia Park')));
    expect(answers()).toEqual([{ p_invite_id: 'inv-1', p_accept: false }]);
    expect(screen.getByText(invitation('Baobab Close'))).toBeTruthy();
    // Declining grants nothing, so there is no post to go looking for.
    expect(mockShift.recheckPost).not.toHaveBeenCalled();
  });

  it('comes back to the plain notice once the last one is declined', async () => {
    mockServer.invites = [ACACIA];
    render(<StartShift />);

    fireEvent.press(await screen.findByRole('button', { name: 'Decline Acacia Park' }));

    expect(await screen.findByText(NOTICE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();
  });

  // Answered on another phone, withdrawn, or the estate closed -- the server
  // will not say which, so the list on screen cannot be trusted any more.
  it('re-reads the list when the invitation is no longer there to answer', async () => {
    mockServer.invites = [ACACIA];
    mockServer.answer = () => {
      mockServer.invites = [BAOBAB];
      return { data: 'not_found', error: null };
    };
    render(<StartShift />);

    fireEvent.press(await screen.findByRole('button', { name: 'Accept Acacia Park' }));

    expect(await screen.findByText(invitation('Baobab Close'))).toBeTruthy();
    expect(screen.queryByText(invitation('Acacia Park'))).toBeNull();
    expect(listed()).toBe(2);
    expect(mockShift.recheckPost).not.toHaveBeenCalled();
  });
});

describe('when answering fails', () => {
  it('says why, and keeps the invitation and both of its buttons', async () => {
    mockServer.invites = [ACACIA];
    mockServer.answer = () => ({ data: null, error: { message: 'JWT expired' } });
    render(<StartShift />);

    fireEvent.press(await screen.findByRole('button', { name: 'Accept Acacia Park' }));

    // On the card as well as in the alert, so it survives the alert going.
    expect(await screen.findByText('JWT expired')).toBeTruthy();
    expect(Alert.alert).toHaveBeenCalledWith('Could not accept', 'JWT expired');
    expect(button('Accept Acacia Park')).toBeEnabled();
    expect(button('Decline Acacia Park')).toBeEnabled();
    expect(mockShift.recheckPost).not.toHaveBeenCalled();
  });

  it('says the phone is offline rather than repeating a fetch error', async () => {
    mockShift.online = false;
    mockServer.invites = [ACACIA];
    mockServer.answer = () => ({
      data: null,
      error: { message: 'TypeError: Network request failed' },
    });
    render(<StartShift />);

    fireEvent.press(await screen.findByRole('button', { name: 'Decline Acacia Park' }));

    expect(await screen.findByText(/This phone is offline/)).toBeTruthy();
    expect(screen.queryByText(/Network request failed/)).toBeNull();
    expect(screen.getByText(invitation('Acacia Park'))).toBeTruthy();
  });

  // Two acceptances racing would be two memberships, and which one became
  // the post would be down to which committed first.
  it('will not send a second answer while the first is in flight', async () => {
    mockServer.invites = [ACACIA, BAOBAB];
    let settle: (r: Result) => void = () => {};
    mockServer.answer = () =>
      new Promise<Result>((resolve) => {
        settle = resolve;
      });
    render(<StartShift />);

    fireEvent.press(await screen.findByRole('button', { name: 'Accept Acacia Park' }));
    await waitFor(() => expect(button('Accept Baobab Close')).toBeDisabled());
    fireEvent.press(button('Accept Baobab Close'));

    expect(answers()).toHaveLength(1);
    await act(async () => settle({ data: 'accepted', error: null }));
  });
});
