import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import SignUp from '@/app/(auth)/sign-up';

const mockSignUp = jest.fn();

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ signUp: mockSignUp }),
}));

const router = () => (global as any).__router;

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).__router = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    dismissTo: jest.fn(),
    canGoBack: jest.fn(() => true),
  };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('sign-up escape hatches', () => {
  // REGRESSION: the screen had no back control and no route to sign-in, so
  // anyone who already had an account was stranded on it.
  it('offers a way back and a way to log in', () => {
    render(<SignUp />);
    expect(screen.getByLabelText('Back')).toBeTruthy();
    expect(screen.getByText(/Already have an account/)).toBeTruthy();
  });

  it('goes back when there is history', () => {
    render(<SignUp />);
    fireEvent.press(screen.getByLabelText('Back'));

    expect(router().back).toHaveBeenCalled();
    expect(router().replace).not.toHaveBeenCalled();
  });

  it('falls back to onboarding when opened with no history', () => {
    router().canGoBack = jest.fn(() => false);

    render(<SignUp />);
    fireEvent.press(screen.getByLabelText('Back'));

    expect(router().back).not.toHaveBeenCalled();
    expect(router().replace).toHaveBeenCalledWith('/(auth)/onboarding');
  });

  // dismissTo rather than push: pushing would stack sign-in → sign-up →
  // sign-in without bound as someone toggles between the two.
  it('pops back to sign-in rather than stacking another copy', () => {
    render(<SignUp />);
    fireEvent.press(screen.getByText(/Already have an account/));

    expect(router().dismissTo).toHaveBeenCalledWith('/(auth)/sign-in');
    expect(router().push).not.toHaveBeenCalled();
  });
});

const fillAccount = () => {
  fireEvent.changeText(screen.getByPlaceholderText('Email'), 'rita@example.com');
  fireEvent.changeText(screen.getByPlaceholderText('Create password'), 'hunter2hunter2');
};

describe('requesting access', () => {
  it('refuses to submit without an email and password', async () => {
    render(<SignUp />);
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Missing details', expect.any(String)),
    );
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  // The whole point of collecting the codes here: an account with no request
  // attached is a stranded user no admin ever sees.
  it('refuses to create an account without both codes', async () => {
    render(<SignUp />);
    fillAccount();
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Both codes needed', expect.any(String)),
    );
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  // A house code is only unique within its estate, so one alone cannot place
  // anyone — half the pair must not be treated as enough.
  it('refuses when only the estate code is given', async () => {
    render(<SignUp />);
    fillAccount();
    fireEvent.changeText(screen.getByPlaceholderText('Estate code'), 'DEMO4821');
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Both codes needed', expect.any(String)),
    );
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('refuses when only the house code is given', async () => {
    render(<SignUp />);
    fillAccount();
    fireEvent.changeText(screen.getByPlaceholderText('House code'), 'LUX5');
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Both codes needed', expect.any(String)),
    );
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('sends the account details and both codes', async () => {
    mockSignUp.mockResolvedValue({ status: 'requested', join: { result: 'ok' } });

    render(<SignUp />);
    fireEvent.changeText(screen.getByPlaceholderText('Email'), '  rita@example.com  ');
    fireEvent.changeText(screen.getByPlaceholderText('Create password'), 'hunter2hunter2');
    fireEvent.changeText(screen.getByPlaceholderText('Full name'), 'Rita Resident');
    fireEvent.changeText(screen.getByPlaceholderText('Estate code'), '  demo-4821  ');
    fireEvent.changeText(screen.getByPlaceholderText('House code'), '  lux5  ');
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    // Trimmed — a trailing space is a silent auth failure on the email and a
    // no-match on either code.
    expect(mockSignUp.mock.calls[0][0]).toEqual({
      email: 'rita@example.com',
      password: 'hunter2hunter2',
      fullName: 'Rita Resident',
      phone: '',
      estateCode: 'demo-4821',
      houseCode: 'lux5',
    });
  });

  // The RPC normalises case and separators, so the screen must not pre-judge
  // the format — it passes what was typed and lets the server decide.
  it('does not reject a lowercase or dashed code locally', async () => {
    mockSignUp.mockResolvedValue({ status: 'requested', join: { result: 'ok' } });

    render(<SignUp />);
    fillAccount();
    fireEvent.changeText(screen.getByPlaceholderText('Estate code'), 'demo-4821');
    fireEvent.changeText(screen.getByPlaceholderText('House code'), 'lux5');
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  // On success the gate is already moving them to /join, which owns the
  // outcome. Navigating from here as well would race it.
  it('does not navigate itself once the request is in', async () => {
    mockSignUp.mockResolvedValue({ status: 'requested', join: { result: 'ok' } });

    render(<SignUp />);
    fillAccount();
    fireEvent.changeText(screen.getByPlaceholderText('Estate code'), 'DEMO4821');
    fireEvent.changeText(screen.getByPlaceholderText('House code'), 'LUX5');
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(router().dismissTo).not.toHaveBeenCalled();
    expect(router().replace).not.toHaveBeenCalled();
  });

  // No session means the request could not be made as them, so say that rather
  // than implying an admin is already looking at it.
  it('sends them to sign in when the email needs confirming', async () => {
    mockSignUp.mockResolvedValue({ status: 'confirm_email' });

    render(<SignUp />);
    fillAccount();
    fireEvent.changeText(screen.getByPlaceholderText('Estate code'), 'DEMO4821');
    fireEvent.changeText(screen.getByPlaceholderText('House code'), 'LUX5');
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Confirm your email',
        expect.any(String),
        expect.any(Array),
      ),
    );
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    buttons[0].onPress();
    expect(router().dismissTo).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('surfaces a rejected account and stays put', async () => {
    mockSignUp.mockResolvedValue({ status: 'error', message: 'Email already registered' });

    render(<SignUp />);
    fillAccount();
    fireEvent.changeText(screen.getByPlaceholderText('Estate code'), 'DEMO4821');
    fireEvent.changeText(screen.getByPlaceholderText('House code'), 'LUX5');
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Could not create your account',
        'Email already registered',
      ),
    );
    expect(router().dismissTo).not.toHaveBeenCalled();
  });
});
