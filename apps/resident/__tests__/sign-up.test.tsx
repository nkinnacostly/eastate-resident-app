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

const requestAccess = () => screen.getByRole('button', { name: 'Request access' });

/**
 * Validation is asynchronous, so the button is the thing to wait on — pressing
 * a still-disabled Pressable is a no-op and would fail later, somewhere less
 * informative.
 */
const submit = async () => {
  await waitFor(() => expect(requestAccess()).toBeEnabled());
  fireEvent.press(requestAccess());
};

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

const type = (placeholder: string, value: string) =>
  fireEvent.changeText(screen.getByPlaceholderText(placeholder), value);

/** Everything the schema requires. Phone is deliberately left out — it is optional. */
const fillEverything = () => {
  type('Full name', 'Rita Resident');
  type('Email', 'rita@example.com');
  type('Create password', 'hunter2hunter2');
  type('Estate code', 'DEMO4821');
  type('House code', 'LUX5');
};

/**
 * The button is the assertion.
 *
 * A schema that rejects bad input is worth nothing if the button next to it is
 * still tappable. Creating half an account is the one outcome this screen must
 * not produce — a user row with no join request attached is invisible to every
 * admin — so these tests drive the real screen through the real resolver and
 * assert on the BUTTON, not on schema output.
 */
describe('the request button', () => {
  it('starts disabled — nothing has been typed', () => {
    render(<SignUp />);
    expect(requestAccess()).toBeDisabled();
  });

  it('stays disabled without an email', async () => {
    render(<SignUp />);
    fillEverything();
    type('Email', '');

    await waitFor(() => expect(requestAccess()).toBeDisabled());
  });

  it('stays disabled while the email is only half typed', async () => {
    render(<SignUp />);
    fillEverything();
    type('Email', 'rita@');

    await waitFor(() => expect(requestAccess()).toBeDisabled());
  });

  // The whole point of collecting the codes here: an account with no request
  // attached is a stranded user no admin ever sees.
  it('stays disabled when only the estate code is given', async () => {
    render(<SignUp />);
    fillEverything();
    type('House code', '');

    await waitFor(() => expect(requestAccess()).toBeDisabled());
  });

  // A house code is only unique within its estate, so one alone cannot place
  // anyone — half the pair must not be treated as enough.
  it('stays disabled when only the house code is given', async () => {
    render(<SignUp />);
    fillEverything();
    type('Estate code', '');

    await waitFor(() => expect(requestAccess()).toBeDisabled());
  });

  // The admin approval queue shows a name and a house number and nothing else.
  // A blank name makes the request unapprovable.
  it('stays disabled without a full name', async () => {
    render(<SignUp />);
    fillEverything();
    type('Full name', '');

    await waitFor(() => expect(requestAccess()).toBeDisabled());
  });

  // Mirrors minimum_password_length in supabase/config.toml — meeting the rule
  // in the field beats meeting it in an alert after the account attempt fails.
  it('stays disabled on a password the server would refuse', async () => {
    render(<SignUp />);
    fillEverything();
    type('Create password', '12345');

    await waitFor(() => expect(requestAccess()).toBeDisabled());
  });

  it('enables once every required field satisfies the schema', async () => {
    render(<SignUp />);
    fillEverything();

    await waitFor(() => expect(requestAccess()).toBeEnabled());
  });

  // Optional means optional: a blank phone must not hold the form hostage.
  it('is enabled with no phone number at all', async () => {
    render(<SignUp />);
    fillEverything();

    await waitFor(() => expect(requestAccess()).toBeEnabled());
    expect(screen.queryByText(/complete phone number/i)).toBeNull();
  });

  it('refuses a phone number that is too short to dial', async () => {
    render(<SignUp />);
    fillEverything();
    type('Phone number (optional)', '0803');

    await waitFor(() => expect(requestAccess()).toBeDisabled());
  });

  // Residents type the same number half a dozen ways. A strict pattern here
  // would reject real numbers for cosmetic reasons.
  it.each(['+234 803 123 4567', '0803-123-4567', '(080) 3123 4567'])(
    'accepts %s',
    async (phone) => {
      render(<SignUp />);
      fillEverything();
      type('Phone number (optional)', phone);

      await waitFor(() => expect(requestAccess()).toBeEnabled());
    },
  );

  it('shows the schema message on blur rather than while typing', async () => {
    render(<SignUp />);
    type('Email', 'not-an-email');
    expect(screen.queryByText(/does not look like an email/i)).toBeNull();

    fireEvent(screen.getByPlaceholderText('Email'), 'blur');
    await screen.findByText(/does not look like an email/i);
  });
});

describe('requesting access', () => {
  it('sends the account details and both codes', async () => {
    mockSignUp.mockResolvedValue({ status: 'requested', join: { result: 'ok' } });

    render(<SignUp />);
    type('Email', '  rita@example.com  ');
    type('Create password', 'hunter2hunter2');
    type('Full name', 'Rita Resident');
    type('Estate code', '  demo-4821  ');
    type('House code', '  lux5  ');
    await submit();

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    // Trimmed by the schema — a trailing space is a silent auth failure on the
    // email and a no-match on either code.
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
    fillEverything();
    type('Estate code', 'demo-4821');
    type('House code', 'lux5');
    await submit();

    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  // On success the gate is already moving them to /join, which owns the
  // outcome. Navigating from here as well would race it.
  it('does not navigate itself once the request is in', async () => {
    mockSignUp.mockResolvedValue({ status: 'requested', join: { result: 'ok' } });

    render(<SignUp />);
    fillEverything();
    await submit();

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
    fillEverything();
    await submit();

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
    fillEverything();
    await submit();

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Could not create your account',
        'Email already registered',
      ),
    );
    expect(router().dismissTo).not.toHaveBeenCalled();
  });

  // An alert is gone the moment it is dismissed. The reason has to survive on
  // screen, or a resident who taps through it is left with a button that did
  // nothing and no explanation.
  it('keeps the rejection on screen after the alert is gone', async () => {
    mockSignUp.mockResolvedValue({ status: 'error', message: 'Email already registered' });

    render(<SignUp />);
    fillEverything();
    await submit();

    await screen.findByText('Email already registered');
  });
});
