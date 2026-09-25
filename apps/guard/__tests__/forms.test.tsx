/**
 * The submit button is the assertion.
 *
 * A schema that rejects bad input is worth nothing if the button next to it is
 * still tappable — the guard taps, the request goes out, and a junk row lands
 * in the audit log. So these tests drive the real screens through the real
 * resolver and assert on the BUTTON, not on schema output. They are also what
 * proves `formState.isValid` tracks every keystroke in `onTouched` mode, which
 * the react-hook-form docs leave ambiguous.
 */
import { CODE_CHARSET } from '@estate/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import SetPassword from '@/app/(auth)/set-password';
import StartShift from '@/app/(auth)/start-shift';
import Check from '@/app/(tabs)/index';

// `mock`-prefixed so jest's module factories are allowed to close over them.
const mockSignIn = jest.fn(async () => ({ error: null as string | null }));
const mockSetPassword = jest.fn(async () => ({ error: null as string | null }));
const mockShift = {
  session: null as unknown,
  post: { membership_id: 'm-1', estate_id: 'e-1', estate_name: 'Acacia Park' },
  online: true,
  poolCount: 4,
  queued: 0,
  poolAgeSeconds: 30,
  stale: false,
  syncing: false,
  loading: false,
  lastPullAt: null,
  refresh: jest.fn(async () => {}),
  sync: jest.fn(async () => {}),
  endShift: jest.fn(async () => {}),
  signIn: mockSignIn,
  mustChangePassword: false as boolean | null,
  setPassword: mockSetPassword,
};

jest.mock('@/lib/shift', () => ({ useShift: () => mockShift }));

const mockVerifyOnline = jest.fn(async () => ({ decision: 'admit', code: '7K4P92' }));
const mockVerifyOffline = jest.fn(async () => ({ decision: 'admit', code: '7K4P92' }));
jest.mock('@/lib/verify', () => ({
  verifyOnline: (...a: unknown[]) => mockVerifyOnline(...(a as [])),
  verifyOffline: (...a: unknown[]) => mockVerifyOffline(...(a as [])),
  REJECT_COPY: {},
}));

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  mockSignIn.mockResolvedValue({ error: null });
  mockSetPassword.mockResolvedValue({ error: null });
  (global as { __router?: unknown }).__router = { push: jest.fn(), replace: jest.fn() };
});

describe('start shift', () => {
  const email = () => screen.getByPlaceholderText('you@estate.co.za');
  const password = () => screen.getByPlaceholderText('Password');

  it('starts with the button disabled — nothing has been typed', () => {
    render(<StartShift />);
    expect(button('Sign in and sync')).toBeDisabled();
  });

  it('stays disabled while the email is only half typed', async () => {
    render(<StartShift />);
    fireEvent.changeText(email(), 'guard@');
    fireEvent.changeText(password(), 'hunter2');

    await waitFor(() => expect(button('Sign in and sync')).toBeDisabled());
  });

  it('stays disabled with a good email and no password', async () => {
    render(<StartShift />);
    fireEvent.changeText(email(), 'guard@estate.co.za');

    await waitFor(() => expect(button('Sign in and sync')).toBeDisabled());
  });

  // The one that matters: isValid has to track keystrokes in onTouched mode,
  // or the button never enables and the app is bricked at sign-in.
  it('enables as soon as both fields satisfy the schema, without a blur', async () => {
    render(<StartShift />);
    fireEvent.changeText(email(), 'guard@estate.co.za');
    fireEvent.changeText(password(), 'hunter2');

    await waitFor(() => expect(button('Sign in and sync')).toBeEnabled());
  });

  it('shows the schema message on blur rather than while typing', async () => {
    render(<StartShift />);
    fireEvent.changeText(email(), 'not-an-email');
    expect(screen.queryByText(/does not look like an email/i)).toBeNull();

    fireEvent(email(), 'blur');
    await screen.findByText(/does not look like an email/i);
  });

  it('signs in with the trimmed address, not the raw field', async () => {
    render(<StartShift />);
    fireEvent.changeText(email(), '  Guard@Estate.co.za  ');
    fireEvent.changeText(password(), 'hunter2');

    await waitFor(() => expect(button('Sign in and sync')).toBeEnabled());
    fireEvent.press(button('Sign in and sync'));

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('Guard@Estate.co.za', 'hunter2'));
  });

  it('leaves the password untouched — a leading space may be part of it', async () => {
    render(<StartShift />);
    fireEvent.changeText(email(), 'guard@estate.co.za');
    fireEvent.changeText(password(), ' hunter2 ');

    await waitFor(() => expect(button('Sign in and sync')).toBeEnabled());
    fireEvent.press(button('Sign in and sync'));

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('guard@estate.co.za', ' hunter2 '));
  });

  it('keeps a failed sign-in on screen instead of only in the alert', async () => {
    mockSignIn.mockResolvedValue({ error: 'Invalid login credentials' });
    render(<StartShift />);
    fireEvent.changeText(email(), 'guard@estate.co.za');
    fireEvent.changeText(password(), 'wrong');

    await waitFor(() => expect(button('Sign in and sync')).toBeEnabled());
    fireEvent.press(button('Sign in and sync'));

    await screen.findByText('Invalid login credentials');
  });
});

describe('code entry', () => {
  const type = (code: string) => {
    for (const char of code) fireEvent.press(screen.getByLabelText(char));
  };

  it('starts with Check disabled', () => {
    render(<Check />);
    expect(button('Check')).toBeDisabled();
  });

  it('stays disabled at five of six characters', async () => {
    render(<Check />);
    type('7K4P9');

    await waitFor(() => expect(button('Check')).toBeDisabled());
  });

  it('enables on the sixth character', async () => {
    render(<Check />);
    type('7K4P92');

    await waitFor(() => expect(button('Check')).toBeEnabled());
  });

  it('disables again after a delete', async () => {
    render(<Check />);
    type('7K4P92');
    await waitFor(() => expect(button('Check')).toBeEnabled());

    fireEvent.press(screen.getByLabelText('Delete'));
    await waitFor(() => expect(button('Check')).toBeDisabled());
  });

  // The charset drops I/O/0/1 because they are misread when a code is read out
  // over a phone at a gate. Derived from CODE_CHARSET rather than written out,
  // so this test cannot drift from the constant the way the prose comments
  // around it did — several of them claim L is excluded, and it is not.
  it('offers exactly the charset and nothing else', () => {
    render(<Check />);
    for (const char of CODE_CHARSET) {
      expect(screen.getByLabelText(char)).toBeTruthy();
    }
    const excluded = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].filter(
      (c) => !CODE_CHARSET.includes(c),
    );
    expect(excluded).toEqual(['I', 'O', '0', '1']);
    for (const char of excluded) {
      expect(screen.queryByLabelText(char)).toBeNull();
    }
  });

  it('sends the completed code to the online verifier', async () => {
    render(<Check />);
    type('7K4P92');
    await waitFor(() => expect(button('Check')).toBeEnabled());

    fireEvent.press(button('Check'));
    await waitFor(() => expect(mockVerifyOnline).toHaveBeenCalledWith('e-1', '7K4P92'));
  });

  it('will not verify without a post to verify against', async () => {
    const post = mockShift.post;
    mockShift.post = null as unknown as typeof post;
    try {
      render(<Check />);
      type('7K4P92');
      await waitFor(() => expect(button('Check')).toBeDisabled());
    } finally {
      mockShift.post = post;
    }
  });
});

/**
 * The handover password is the one an admin generated, read off a screen and
 * said out loud. These assert the button, same as the rest of this file: a
 * mismatch rule that only renders a message is worth nothing if the guard can
 * still submit past it.
 */
describe('set password', () => {
  const next = () => screen.getByPlaceholderText('New password');
  const again = () => screen.getByPlaceholderText('Repeat it');

  it('starts disabled — nothing has been typed', () => {
    render(<SetPassword />);
    expect(button('Save and start')).toBeDisabled();
  });

  it('stays disabled below the 8-character floor Supabase itself enforces', async () => {
    render(<SetPassword />);
    fireEvent.changeText(next(), 'short');
    fireEvent.changeText(again(), 'short');

    await waitFor(() => expect(button('Save and start')).toBeDisabled());
  });

  // The whole point of the second field. A typo here sets a password the guard
  // cannot type again, on an account they cannot recover without an admin.
  it('stays disabled while the two do not match', async () => {
    render(<SetPassword />);
    fireEvent.changeText(next(), 'gatehouse42');
    fireEvent.changeText(again(), 'gatehouse43');

    await waitFor(() => expect(button('Save and start')).toBeDisabled());
  });

  it('enables once both are long enough and identical', async () => {
    render(<SetPassword />);
    fireEvent.changeText(next(), 'gatehouse42');
    fireEvent.changeText(again(), 'gatehouse42');

    await waitFor(() => expect(button('Save and start')).toBeEnabled());
  });

  // Not trimmed, deliberately: a leading space is a legitimate character, and
  // eating it would set a password that never works again.
  it('passes the password through untouched, spaces and all', async () => {
    render(<SetPassword />);
    fireEvent.changeText(next(), ' gatehouse42 ');
    fireEvent.changeText(again(), ' gatehouse42 ');

    await waitFor(() => expect(button('Save and start')).toBeEnabled());
    fireEvent.press(button('Save and start'));

    await waitFor(() => expect(mockSetPassword).toHaveBeenCalledWith(' gatehouse42 '));
  });

  it('keeps a rejected password on screen rather than only in the alert', async () => {
    mockSetPassword.mockResolvedValue({ error: 'This password is known to be compromised.' });
    render(<SetPassword />);
    fireEvent.changeText(next(), 'gatehouse42');
    fireEvent.changeText(again(), 'gatehouse42');

    await waitFor(() => expect(button('Save and start')).toBeEnabled());
    fireEvent.press(button('Save and start'));

    await screen.findByText(/known to be compromised/i);
  });
});

/**
 * The password reveal.
 *
 * Worth testing rather than eyeballing, because the failure mode is silent and
 * severe: `secureTextEntry` stuck ON looks identical to a working toggle
 * (dots either way), and stuck OFF shows a guard's password on screen at a
 * gate with people standing next to them. Neither is visible in a screenshot
 * of the default state.
 */
describe('password reveal', () => {
  const eye = () => screen.getByLabelText('Show password');
  const eyeOff = () => screen.getByLabelText('Hide password');
  const password = () => screen.getByPlaceholderText('Password');

  it('starts hidden', () => {
    render(<StartShift />);
    expect(password().props.secureTextEntry).toBe(true);
    // Labelled by what the tap DOES, not by what the icon depicts.
    expect(eye()).toBeTruthy();
  });

  it('reveals on tap and offers to hide', () => {
    render(<StartShift />);
    fireEvent.press(eye());

    expect(password().props.secureTextEntry).toBe(false);
    expect(eyeOff()).toBeTruthy();
    expect(screen.queryByLabelText('Show password')).toBeNull();
  });

  it('hides again on a second tap', () => {
    render(<StartShift />);
    fireEvent.press(eye());
    fireEvent.press(eyeOff());

    expect(password().props.secureTextEntry).toBe(true);
    expect(eye()).toBeTruthy();
  });

  // The iOS failure this guards against: toggling secureTextEntry can fire
  // onChangeText with an empty string and wipe the form state
  // (facebook/react-native#12939). The value is controlled by react-hook-form,
  // so what matters is that typing still reaches it after a toggle.
  it('keeps the typed value and stays submittable across a toggle', async () => {
    render(<StartShift />);
    fireEvent.changeText(screen.getByPlaceholderText('you@estate.co.za'), 'guard@estate.co.za');
    fireEvent.changeText(password(), 'hunter2');
    await waitFor(() => expect(button('Sign in and sync')).toBeEnabled());

    fireEvent.press(eye());
    expect(password().props.value).toBe('hunter2');
    await waitFor(() => expect(button('Sign in and sync')).toBeEnabled());

    // And a keystroke made while revealed still lands.
    fireEvent.changeText(password(), 'hunter22');
    fireEvent.press(eyeOff());
    expect(password().props.value).toBe('hunter22');

    fireEvent.press(button('Sign in and sync'));
    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith('guard@estate.co.za', 'hunter22'),
    );
  });

  // Two password fields on one screen, each with its own eye.
  it('reveals each field independently', () => {
    render(<SetPassword />);
    const eyes = screen.getAllByLabelText('Show password');
    expect(eyes).toHaveLength(2);

    fireEvent.press(eyes[0]);
    expect(screen.getByPlaceholderText('New password').props.secureTextEntry).toBe(false);
    // Revealing the new password must not also reveal the confirmation.
    expect(screen.getByPlaceholderText('Repeat it').props.secureTextEntry).toBe(true);
  });

  it('puts no eye on a field that is not a password', () => {
    render(<StartShift />);
    expect(screen.getByPlaceholderText('you@estate.co.za').props.secureTextEntry).toBeFalsy();
    expect(screen.getAllByLabelText('Show password')).toHaveLength(1);
  });
});
