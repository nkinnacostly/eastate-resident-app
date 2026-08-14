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

describe('requesting access', () => {
  it('refuses to submit without an email and password', async () => {
    render(<SignUp />);
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Missing details', expect.any(String)),
    );
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('sends the typed details and routes on to sign-in', async () => {
    mockSignUp.mockResolvedValue({ error: null });

    render(<SignUp />);
    fireEvent.changeText(screen.getByPlaceholderText('Email'), '  rita@example.com  ');
    fireEvent.changeText(screen.getByPlaceholderText('Create password'), 'hunter2hunter2');
    fireEvent.changeText(screen.getByPlaceholderText('Full name'), 'Rita Resident');
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    // Trimmed — a trailing space in an email is a silent auth failure.
    expect(mockSignUp.mock.calls[0][0]).toMatchObject({
      email: 'rita@example.com',
      password: 'hunter2hunter2',
      fullName: 'Rita Resident',
    });

    // The alert's action is what carries the user onward.
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    buttons[0].onPress();
    expect(router().dismissTo).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('surfaces a rejected request and stays put', async () => {
    mockSignUp.mockResolvedValue({ error: 'Email already registered' });

    render(<SignUp />);
    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'rita@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('Create password'), 'hunter2hunter2');
    fireEvent.press(screen.getByText('Request access'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Could not request access',
        'Email already registered',
      ),
    );
    expect(router().dismissTo).not.toHaveBeenCalled();
  });
});
