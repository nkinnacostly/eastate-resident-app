import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ForgotPassword from '@/app/(auth)/forgot-password';
import ResetPassword from '@/app/(auth)/reset-password';

const mockRequestPasswordReset = jest.fn();
const mockCompletePasswordReset = jest.fn();

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    requestPasswordReset: mockRequestPasswordReset,
    completePasswordReset: mockCompletePasswordReset,
  }),
}));

const router = () => (global as unknown as { __router: Record<string, jest.Mock> }).__router;
const setParams = (p: Record<string, string>) => {
  (global as unknown as { __params: Record<string, string> }).__params = p;
};

beforeEach(() => {
  jest.clearAllMocks();
  (global as unknown as { __router: unknown }).__router = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    dismissTo: jest.fn(),
    canGoBack: jest.fn(() => true),
  };
  setParams({});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

const type = (placeholder: string, value: string) =>
  fireEvent.changeText(screen.getByPlaceholderText(placeholder), value);

const pressWhenEnabled = async (name: string) => {
  const button = () => screen.getByRole('button', { name });
  await waitFor(() => expect(button()).toBeEnabled());
  fireEvent.press(button());
};

describe('forgot password — asking for a code', () => {
  it('carries the address to the next screen so it cannot be retyped wrongly', async () => {
    mockRequestPasswordReset.mockResolvedValue({ error: null });

    render(<ForgotPassword />);
    type('you@example.com', 'rita@example.com');
    await pressWhenEnabled('Send code');

    await waitFor(() =>
      expect(router().push).toHaveBeenCalledWith({
        pathname: '/(auth)/reset-password',
        params: { email: 'rita@example.com' },
      }),
    );
  });

  /**
   * The whole point of the endpoint's uniform response. If this screen ever
   * grows a "no account with that address" branch, it becomes a way to test
   * whether a given person lives on the estate.
   */
  it('moves on identically whatever the address is, revealing nothing', async () => {
    mockRequestPasswordReset.mockResolvedValue({ error: null });

    render(<ForgotPassword />);
    type('you@example.com', 'nobody-here@example.com');
    await pressWhenEnabled('Send code');

    await waitFor(() => expect(router().push).toHaveBeenCalled());
    expect(screen.queryByText(/no account/i)).toBeNull();
    expect(screen.queryByText(/not found/i)).toBeNull();
  });

  it('stays put and explains itself when the request could not be sent', async () => {
    mockRequestPasswordReset.mockResolvedValue({ error: 'No connection.' });

    render(<ForgotPassword />);
    type('you@example.com', 'rita@example.com');
    await pressWhenEnabled('Send code');

    await waitFor(() => expect(screen.getByText('No connection.')).toBeTruthy());
    expect(router().push).not.toHaveBeenCalled();
  });

  it('trims the address before sending it', async () => {
    mockRequestPasswordReset.mockResolvedValue({ error: null });

    render(<ForgotPassword />);
    type('you@example.com', '  rita@example.com ');
    await pressWhenEnabled('Send code');

    await waitFor(() =>
      expect(mockRequestPasswordReset).toHaveBeenCalledWith('rita@example.com'),
    );
  });
});

describe('reset password — redeeming the code', () => {
  const fill = (code = '12345678', password = 'newpassword') => {
    type('Code from your email', code);
    type('New password', password);
  };

  it('refuses to render a form it cannot submit when the address is missing', () => {
    setParams({});
    render(<ResetPassword />);

    expect(screen.getByText('Start again')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Code from your email')).toBeNull();
  });

  it('redeems the code and the new password together, in one call', async () => {
    setParams({ email: 'rita@example.com' });
    mockCompletePasswordReset.mockResolvedValue({ status: 'ok' });

    render(<ResetPassword />);
    fill();
    await pressWhenEnabled('Set new password');

    await waitFor(() =>
      expect(mockCompletePasswordReset).toHaveBeenCalledWith(
        'rita@example.com',
        '12345678',
        'newpassword',
      ),
    );
  });

  /**
   * REGRESSION GUARD. Navigating on success would race the gate, which is
   * already swapping this stack out because the reset signed the resident in.
   * The screen must do nothing and let the gate move.
   */
  it('does not navigate on success — the gate owns that', async () => {
    setParams({ email: 'rita@example.com' });
    mockCompletePasswordReset.mockResolvedValue({ status: 'ok' });

    render(<ResetPassword />);
    fill();
    await pressWhenEnabled('Set new password');

    await waitFor(() => expect(mockCompletePasswordReset).toHaveBeenCalled());
    expect(router().push).not.toHaveBeenCalled();
    expect(router().replace).not.toHaveBeenCalled();
  });

  it('keeps a wrong code on the screen with a way forward', async () => {
    setParams({ email: 'rita@example.com' });
    mockCompletePasswordReset.mockResolvedValue({ status: 'bad_code' });

    render(<ResetPassword />);
    fill('00000000');
    await pressWhenEnabled('Set new password');

    await waitFor(() => expect(screen.getByText(/wrong or has expired/i)).toBeTruthy());
    expect(screen.getByPlaceholderText('Code from your email')).toBeTruthy();
  });

  it('surfaces a failed password change rather than implying it worked', async () => {
    setParams({ email: 'rita@example.com' });
    mockCompletePasswordReset.mockResolvedValue({
      status: 'error',
      message: 'Password is too weak.',
    });

    render(<ResetPassword />);
    fill();
    await pressWhenEnabled('Set new password');

    await waitFor(() => expect(screen.getByText('Password is too weak.')).toBeTruthy());
  });

  it('can ask for a fresh code without leaving the screen', async () => {
    setParams({ email: 'rita@example.com' });
    mockRequestPasswordReset.mockResolvedValue({ error: null });

    render(<ResetPassword />);
    fireEvent.press(screen.getByText('Send a new code'));

    await waitFor(() =>
      expect(mockRequestPasswordReset).toHaveBeenCalledWith('rita@example.com'),
    );
    // Asking again invalidates the previous code, so the resident is told which
    // one to use rather than being left with two and no guidance.
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('New code sent', expect.stringMatching(/newest/i)),
    );
  });

  it('will not submit a half-typed code', async () => {
    setParams({ email: 'rita@example.com' });

    render(<ResetPassword />);
    fill('123', 'newpassword');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Set new password' })).toBeDisabled(),
    );
    expect(mockCompletePasswordReset).not.toHaveBeenCalled();
  });
});
