import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import VerifyEmail from '@/app/(auth)/verify-email';

const mockCompleteSignUpVerification = jest.fn();
const mockResendSignUpCode = jest.fn();

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    completeSignUpVerification: mockCompleteSignUpVerification,
    resendSignUpCode: mockResendSignUpCode,
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
  setParams({ email: 'rita@example.com' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

const type = (value: string) =>
  fireEvent.changeText(screen.getByPlaceholderText('Code from your email'), value);

const pressWhenEnabled = async (name: string) => {
  const button = () => screen.getByRole('button', { name });
  await waitFor(() => expect(button()).toBeEnabled());
  fireEvent.press(button());
};

describe('sign-up email verification', () => {
  it('confirms with the code it was given, for the address it was given', async () => {
    mockCompleteSignUpVerification.mockResolvedValue({ status: 'ok' });

    render(<VerifyEmail />);
    type('123456');
    await pressWhenEnabled('Confirm email');

    await waitFor(() =>
      expect(mockCompleteSignUpVerification).toHaveBeenCalledWith('rita@example.com', '123456'),
    );
  });

  /**
   * REGRESSION GUARD. Verification signs the resident in, so the gate is
   * already swapping this stack out. Navigating from here would race it.
   */
  it('does not navigate on success — the gate owns that', async () => {
    mockCompleteSignUpVerification.mockResolvedValue({ status: 'ok' });

    render(<VerifyEmail />);
    type('123456');
    await pressWhenEnabled('Confirm email');

    await waitFor(() => expect(mockCompleteSignUpVerification).toHaveBeenCalled());
    expect(router().push).not.toHaveBeenCalled();
    expect(router().replace).not.toHaveBeenCalled();
  });

  it('keeps a wrong code on the screen with a way forward', async () => {
    mockCompleteSignUpVerification.mockResolvedValue({ status: 'bad_code' });

    render(<VerifyEmail />);
    type('000000');
    await pressWhenEnabled('Confirm email');

    await waitFor(() => expect(screen.getByText(/wrong or has expired/i)).toBeTruthy());
    expect(screen.getByPlaceholderText('Code from your email')).toBeTruthy();
  });

  it('surfaces a transport failure rather than implying it worked', async () => {
    mockCompleteSignUpVerification.mockResolvedValue({
      status: 'error',
      message: 'No connection. Try again once you are back online.',
    });

    render(<VerifyEmail />);
    type('123456');
    await pressWhenEnabled('Confirm email');

    await waitFor(() => expect(screen.getByText(/No connection/)).toBeTruthy());
  });

  it('can ask for a fresh code without leaving the screen', async () => {
    mockResendSignUpCode.mockResolvedValue({ error: null });

    render(<VerifyEmail />);
    fireEvent.press(screen.getByText('Send a new code'));

    await waitFor(() =>
      expect(mockResendSignUpCode).toHaveBeenCalledWith('rita@example.com'),
    );
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('New code sent', expect.stringMatching(/newest/i)),
    );
  });

  it('reports a refused resend instead of claiming one was sent', async () => {
    mockResendSignUpCode.mockResolvedValue({ error: 'For security purposes, wait 60 seconds' });

    render(<VerifyEmail />);
    fireEvent.press(screen.getByText('Send a new code'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Could not send a new code',
        'For security purposes, wait 60 seconds',
      ),
    );
  });

  it('will not submit a half-typed code', async () => {
    render(<VerifyEmail />);
    type('12');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm email' })).toBeDisabled(),
    );
    expect(mockCompleteSignUpVerification).not.toHaveBeenCalled();
  });

  /**
   * There is no back control on purpose: the account already exists, so a
   * sign-up form would refuse the same address. Sign-in is the escape hatch,
   * and it must always be present.
   */
  it('offers sign-in as the escape hatch, and no route back to sign-up', () => {
    render(<VerifyEmail />);

    expect(screen.queryByLabelText('Back')).toBeNull();
    fireEvent.press(screen.getByText(/Confirm later/));
    expect(router().replace).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('refuses to render a form it cannot submit when the address is missing', () => {
    setParams({});
    render(<VerifyEmail />);

    expect(screen.getByText('Start again')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Code from your email')).toBeNull();
  });
});
