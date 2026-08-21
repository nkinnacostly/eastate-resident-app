/**
 * The submit button is the assertion.
 *
 * A schema that rejects bad input is worth nothing if the button next to it is
 * still tappable. These tests drive the real screen through the real resolver
 * and assert on the BUTTON, not on schema output — they are also what proves
 * `formState.isValid` tracks every keystroke in `onTouched` mode, which the
 * react-hook-form docs leave ambiguous.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import SignIn from '@/app/(auth)/sign-in';

const mockSignIn = jest.fn();

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ signIn: mockSignIn }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSignIn.mockResolvedValue({ error: null });
  (global as any).__router = { push: jest.fn() };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

const login = () => screen.getByRole('button', { name: 'Log in' });
const email = () => screen.getByPlaceholderText('you@example.com');
const password = () => screen.getByPlaceholderText('Password');

describe('the log in button', () => {
  it('starts disabled — nothing has been typed', () => {
    render(<SignIn />);
    expect(login()).toBeDisabled();
  });

  it('stays disabled while the email is only half typed', async () => {
    render(<SignIn />);
    fireEvent.changeText(email(), 'rita@');
    fireEvent.changeText(password(), 'hunter2');

    await waitFor(() => expect(login()).toBeDisabled());
  });

  it('stays disabled with a good email and no password', async () => {
    render(<SignIn />);
    fireEvent.changeText(email(), 'rita@example.com');

    await waitFor(() => expect(login()).toBeDisabled());
  });

  // The one that matters: isValid has to track keystrokes in onTouched mode, or
  // the button never enables and the app is bricked at sign-in.
  it('enables as soon as both fields satisfy the schema, without a blur', async () => {
    render(<SignIn />);
    fireEvent.changeText(email(), 'rita@example.com');
    fireEvent.changeText(password(), 'hunter2');

    await waitFor(() => expect(login()).toBeEnabled());
  });

  // A short password is a WRONG password here, not an invalid one. This screen
  // must not apply today's rules to an account whose password predates them —
  // its only recovery route is "ask your estate admin".
  it('does not impose a minimum length on an existing password', async () => {
    render(<SignIn />);
    fireEvent.changeText(email(), 'rita@example.com');
    fireEvent.changeText(password(), 'x');

    await waitFor(() => expect(login()).toBeEnabled());
  });
});

describe('signing in', () => {
  it('shows the schema message on blur rather than while typing', async () => {
    render(<SignIn />);
    fireEvent.changeText(email(), 'not-an-email');
    expect(screen.queryByText(/does not look like an email/i)).toBeNull();

    fireEvent(email(), 'blur');
    await screen.findByText(/does not look like an email/i);
  });

  it('signs in with the trimmed address, not the raw field', async () => {
    render(<SignIn />);
    fireEvent.changeText(email(), '  Rita@Example.com  ');
    fireEvent.changeText(password(), 'hunter2');

    await waitFor(() => expect(login()).toBeEnabled());
    fireEvent.press(login());

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('Rita@Example.com', 'hunter2'));
  });

  // Trimming this would turn a correct password into a failed sign-in with no
  // explanation — a leading space may be part of it.
  it('leaves the password exactly as typed', async () => {
    render(<SignIn />);
    fireEvent.changeText(email(), 'rita@example.com');
    fireEvent.changeText(password(), ' hunter2 ');

    await waitFor(() => expect(login()).toBeEnabled());
    fireEvent.press(login());

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('rita@example.com', ' hunter2 '));
  });

  it('keeps a failed sign-in on screen instead of only in the alert', async () => {
    mockSignIn.mockResolvedValue({ error: 'Invalid login credentials' });

    render(<SignIn />);
    fireEvent.changeText(email(), 'rita@example.com');
    fireEvent.changeText(password(), 'wrong');

    await waitFor(() => expect(login()).toBeEnabled());
    fireEvent.press(login());

    await screen.findByText('Invalid login credentials');
    expect(Alert.alert).toHaveBeenCalledWith('Could not sign in', 'Invalid login credentials');
  });
});
