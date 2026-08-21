import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import Join from '@/app/join';

const mockRequest = jest.fn();
const mockPending = jest.fn();
jest.mock('@/lib/api', () => ({
  requestHouseAccess: (...a: unknown[]) => mockRequest(...a),
  myPendingJoinRequests: (...a: unknown[]) => mockPending(...a),
}));

const mockRefresh = jest.fn();
const mockSignOut = jest.fn();
const mockTakeSignUp = jest.fn();
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    refreshMemberships: mockRefresh,
    signOut: mockSignOut,
    takeSignUpJoinResult: mockTakeSignUp,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  // Default arrival: nothing handed over from sign-up, nothing pending.
  mockTakeSignUp.mockReturnValue(null);
  mockPending.mockResolvedValue([]);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

/** The screen checks the server before deciding what to show. */
const renderSettled = async () => {
  render(<Join />);
  await waitFor(() => expect(mockPending).toHaveBeenCalled());
};

const requestAccess = () => screen.getByRole('button', { name: 'Request access' });

const fill = (estate: string, house = 'H4K2') => {
  fireEvent.changeText(screen.getByPlaceholderText('Estate code'), estate);
  fireEvent.changeText(screen.getByPlaceholderText('House code'), house);
};

/**
 * Validation is asynchronous, so the button is the thing to wait on — pressing
 * a still-disabled Pressable is a no-op and would fail later, somewhere less
 * informative.
 */
const submit = async () => {
  await waitFor(() => expect(requestAccess()).toBeEnabled());
  fireEvent.press(requestAccess());
};

describe('arriving from sign-up', () => {
  // The codes are typed at sign-up now, so the common arrival is "already
  // waiting" — the form would read as though nothing had been sent.
  it('shows the waiting state for a request the server already has', async () => {
    mockPending.mockResolvedValue([
      { estate_id: 'e1', estate_name: 'Demo Estate', house_number: '27', created_at: 'x' },
    ]);

    await renderSettled();

    await waitFor(() => expect(screen.getByText('Waiting on approval')).toBeTruthy());
    expect(screen.getByText(/House 27, Demo Estate/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('Estate code')).toBeNull();
  });

  // REGRESSION: waiting state lived only in this screen's own state, so killing
  // the app dropped it and the applicant was shown a blank form.
  it('survives a restart, because the pending state is read from the server', async () => {
    mockPending.mockResolvedValue([
      { estate_id: 'e1', estate_name: 'Demo Estate', house_number: '27', created_at: 'x' },
    ]);

    await renderSettled();
    await waitFor(() => expect(screen.getByText('Waiting on approval')).toBeTruthy());
    // Nothing was typed and nothing was submitted — the state came from the RPC.
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // A rejected request leaves NOTHING on the server to read back, so the reason
  // has to travel from sign-up or it is lost.
  it('reports a bad house code handed over from sign-up', async () => {
    mockTakeSignUp.mockReturnValue({
      result: 'unknown_house', estate_id: 'e1', estate_name: 'Demo Estate',
      house_id: null, house_number: null,
    });

    await renderSettled();

    await waitFor(() => expect(screen.getByText('House code not recognised')).toBeTruthy());
    expect(screen.getByText(/Your account is saved/)).toBeTruthy();
    // And the form is there to correct it.
    expect(screen.getByPlaceholderText('House code')).toBeTruthy();
  });

  it('reports a bad estate code handed over from sign-up', async () => {
    mockTakeSignUp.mockReturnValue({
      result: 'unknown_estate', estate_id: null, estate_name: null,
      house_id: null, house_number: null,
    });

    await renderSettled();

    await waitFor(() => expect(screen.getByText('Estate code not recognised')).toBeTruthy());
  });

  // Consumed once: a later visit must not replay an error from a sign-up that
  // was already dealt with.
  it('takes the sign-up outcome exactly once', async () => {
    await renderSettled();
    expect(mockTakeSignUp).toHaveBeenCalledTimes(1);
  });

  // A failed lookup is not evidence that no request exists, but the screen must
  // still become usable rather than spinning forever.
  it('falls through to the form when the lookup fails', async () => {
    mockPending.mockRejectedValue(new Error('offline'));

    await renderSettled();

    await waitFor(() => expect(screen.getByPlaceholderText('Estate code')).toBeTruthy());
  });
});

/**
 * The button is the assertion. This is the last screen before the app is
 * unusable, so a half-filled request must be impossible to send rather than
 * merely discouraged.
 */
describe('the request button', () => {
  it('starts disabled — neither code has been typed', async () => {
    await renderSettled();
    expect(requestAccess()).toBeDisabled();
  });

  // A house code alone cannot place anyone: it is only unique within an estate.
  it('stays disabled with only the estate code', async () => {
    await renderSettled();
    fireEvent.changeText(screen.getByPlaceholderText('Estate code'), '9Y9EAEYH');

    await waitFor(() => expect(requestAccess()).toBeDisabled());
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('stays disabled with only the house code', async () => {
    await renderSettled();
    fireEvent.changeText(screen.getByPlaceholderText('House code'), 'H4K2');

    await waitFor(() => expect(requestAccess()).toBeDisabled());
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // Whitespace is not a code. Without the trim in the schema this passes a
  // presence check and fails at the server as "unknown estate".
  it('treats a field of spaces as empty', async () => {
    await renderSettled();
    fill('   ', '   ');

    await waitFor(() => expect(requestAccess()).toBeDisabled());
  });

  it('enables once both codes are present', async () => {
    await renderSettled();
    fill('9Y9EAEYH');

    await waitFor(() => expect(requestAccess()).toBeEnabled());
  });
});

describe('joining by hand', () => {
  it('sends the code and confirms which house it reached', async () => {
    mockRequest.mockResolvedValue({
      result: 'ok', estate_id: 'e1', estate_name: 'Demo Estate',
      house_id: 'h1', house_number: '27',
    });

    await renderSettled();
    fill('  demo-4821  ', '  h4k2  ');
    await submit();

    await waitFor(() => expect(screen.getByText(/House 27, Demo Estate/)).toBeTruthy());
    // Both trimmed — a stray space would not match either stored code.
    expect(mockRequest).toHaveBeenCalledWith('demo-4821', 'h4k2');
  });

  // The RPC normalises case and separators, so the app must not pre-judge the
  // format — it passes what was typed and lets the server decide.
  it('does not reject a lowercase or dashed code locally', async () => {
    mockRequest.mockResolvedValue({
      result: 'ok', estate_id: 'e1', estate_name: 'Demo Estate', house_id: 'h1', house_number: '27',
    });

    await renderSettled();
    fill('demo4821', 'h4k2');
    await submit();

    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('shows the waiting state for a request already pending', async () => {
    mockRequest.mockResolvedValue({
      result: 'already_pending', estate_id: 'e1', estate_name: 'Demo Estate',
      house_id: 'h1', house_number: '27',
    });

    await renderSettled();
    fill('DEMO4821');
    await submit();

    await waitFor(() => expect(screen.getByText(/House 27, Demo Estate/)).toBeTruthy());
  });

  // Already a member means an admin approved them while this screen was open.
  // Reloading memberships is what lets the gate move them to the tabs.
  it('reloads memberships when the estate already accepted them', async () => {
    mockRequest.mockResolvedValue({
      result: 'already_a_member', estate_id: 'e1', estate_name: 'Demo Estate',
      house_id: 'h1', house_number: '27',
    });

    await renderSettled();
    fill('DEMO4821');
    await submit();

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(screen.queryByText('Waiting on approval')).toBeNull();
  });

  // Two distinct messages: telling someone "code not recognised" when only the
  // HOUSE code is wrong sends them back to the wrong person for help.
  it('blames the estate code when that is the wrong one', async () => {
    mockRequest.mockResolvedValue({
      result: 'unknown_estate', estate_id: null, estate_name: null, house_id: null, house_number: null,
    });

    await renderSettled();
    fill('NOPE1234');
    await submit();

    await waitFor(() => expect(screen.getByText('Estate code not recognised')).toBeTruthy());
    expect(screen.queryByText('Waiting on approval')).toBeNull();
  });

  it('blames the house code when that is the wrong one', async () => {
    mockRequest.mockResolvedValue({
      result: 'unknown_house', estate_id: 'e1', estate_name: 'Demo Estate',
      house_id: null, house_number: null,
    });

    await renderSettled();
    fill('9Y9EAEYH', 'ZZZZ');
    await submit();

    await waitFor(() => expect(screen.getByText('House code not recognised')).toBeTruthy());
    expect(screen.getByText(/Check it with your landlord/)).toBeTruthy();
  });

  it('explains a rate limit', async () => {
    mockRequest.mockResolvedValue({
      result: 'rate_limited', estate_id: null, estate_name: null, house_id: null, house_number: null,
    });

    await renderSettled();
    fill('DEMO4821');
    await submit();

    await waitFor(() => expect(screen.getByText('Too many tries')).toBeTruthy());
  });

  it('surfaces a thrown error instead of crashing', async () => {
    mockRequest.mockRejectedValue(new Error('network down'));

    await renderSettled();
    fill('DEMO4821');
    await submit();

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Could not send the request', 'network down'),
    );
    // And it stays on screen after the alert is dismissed.
    await screen.findByText('network down');
  });

  it('lets a stranded user sign out', async () => {
    await renderSettled();
    fireEvent.press(screen.getByText('Sign out'));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
