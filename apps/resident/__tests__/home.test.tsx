import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import Home from '@/app/(tabs)/index';

// jest.mock factories are hoisted, so anything they close over must be
// `mock`-prefixed.
const mockPush = jest.fn();
const mockMint = jest.fn();
let mockLive: any[] = [];

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    session: { user: { user_metadata: { full_name: 'Rita Resident' } } },
    memberships: [
      { id: 'm1', estate_id: 'estate-1', role: 'resident', estate_name: 'Demo Estate' },
    ],
    activeEstateId: 'estate-1',
  }),
}));

const mockCodesState = () => ({
  live: mockLive,
  loading: false,
  refresh: jest.fn(),
  mint: mockMint,
});
// Home reads dues status to decide whether to warn before a resident is
// refused. Mocked like @/lib/codes so these tests do not drag in the real
// Supabase client (and with it AsyncStorage) through lib/api.
const mockDuesRefresh = jest.fn();
let mockDues: Record<string, unknown> = {};
jest.mock('@/lib/dues-status', () => ({
  useDuesStatus: () => ({
    overdue: [], outstanding: [], totalOwedMinor: 0, currency: 'NGN',
    blocked: false, owesButNotBlocked: false, loading: false,
    refresh: mockDuesRefresh,
    ...mockDues,
  }),
}));

jest.mock('@/lib/codes', () => ({
  useCodes: () => mockCodesState(),
  // Screens read through the focus-aware wrapper so switching tabs refetches.
  useCodesOnFocus: () => mockCodesState(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLive = [];
  (global as any).__router = { push: mockPush };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

const liveCode = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  code: 'B7PJU6',
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 5 * 3600_000).toISOString(),
  used_at: null,
  revoked_reason: null,
  status: 'live',
  ...over,
});

describe('Home', () => {
  it('greets by first name and names the estate', () => {
    render(<Home />);
    expect(screen.getByText('Hi, Rita')).toBeTruthy();
    expect(screen.getByText('DEMO ESTATE')).toBeTruthy();
  });

  it('counts live codes against the cap', () => {
    mockLive = [liveCode(), liveCode({ id: 'c2', code: 'QT3W7H' })];
    render(<Home />);
    expect(screen.getByText('2 of 3')).toBeTruthy();
  });

  it('shows an empty state when nothing is live', () => {
    render(<Home />);
    expect(screen.getByText(/No live codes/)).toBeTruthy();
  });

  // The critical branch: mint returns RESULTS, not errors (Technical Design
  // §3.1), so each outcome has to land somewhere sensible.
  it('navigates to the code screen on a successful mint', async () => {
    mockMint.mockResolvedValue({ result: 'ok', code: 'B7PJU6', expires_at: '2026-08-14T17:25:10Z' });
    render(<Home />);

    fireEvent.press(screen.getByText('Generate code'));
    // Generating now opens the delivery question first. These cases are about
    // where each mint RESULT lands, so they take the plain-visitor answer.
    fireEvent.press(screen.getByText('No, a visitor'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/code/[code]',
        params: { code: 'B7PJU6' },
      }),
    );
    // No timestamp in the route — that was the "Invalid Date" bug.
    expect(mockPush.mock.calls[0][0].params).not.toHaveProperty('expires');
  });

  it('sends a capped resident to the Codes tab, without an error dialog', async () => {
    mockMint.mockResolvedValue({ result: 'code_limit_reached', code: null, expires_at: null });
    render(<Home />);

    fireEvent.press(screen.getByText('Generate code'));
    // Generating now opens the delivery question first. These cases are about
    // where each mint RESULT lands, so they take the plain-visitor answer.
    fireEvent.press(screen.getByText('No, a visitor'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(tabs)/codes'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('explains a rate limit without navigating', async () => {
    mockMint.mockResolvedValue({ result: 'rate_limited', code: null, expires_at: null });
    render(<Home />);

    fireEvent.press(screen.getByText('Generate code'));
    // Generating now opens the delivery question first. These cases are about
    // where each mint RESULT lands, so they take the plain-visitor answer.
    fireEvent.press(screen.getByText('No, a visitor'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Slow down', expect.any(String)),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('surfaces a thrown error instead of crashing', async () => {
    mockMint.mockRejectedValue(new Error('network down'));
    render(<Home />);

    fireEvent.press(screen.getByText('Generate code'));
    // Generating now opens the delivery question first. These cases are about
    // where each mint RESULT lands, so they take the plain-visitor answer.
    fireEvent.press(screen.getByText('No, a visitor'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Could not generate a code', 'network down'),
    );
  });
});

// ─── The reported dead end ───────────────────────────────────────────────────
//
// A resident with overdue dues pressed Generate and was told "Could not
// generate a code. Please try again." Trying again could never have worked.
// The refusal was correct; every word around it was wrong.
describe('a refusal for unpaid dues', () => {
  const generate = async () => {
    render(<Home />);
    fireEvent.press(screen.getByText('Generate code'));
    // The delivery sheet is asked BEFORE anything is minted.
    fireEvent.press(await screen.findByText(/^No$|Not a delivery|A visitor$/i));
  };

  it('says why, and offers the way out', async () => {
    mockMint.mockResolvedValue({ result: 'dues_unpaid', code: null, expires_at: null });
    await generate();

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1);

    // Never the old wording. "Try again" invites a retry that cannot succeed.
    expect(title).not.toMatch(/try again/i);
    expect(title).toMatch(/dues/i);
    expect(body).toMatch(/paused until your estate dues are paid/i);

    // And the two reassurances, because being locked out of your own home is
    // the fear this message exists to remove.
    expect(body).toMatch(/own access to the estate is not affected/i);
    expect(body).toMatch(/already shared still work/i);

    // A route to paying, not just an apology.
    const pay = buttons.find((b: any) => /owed|pay/i.test(b.text));
    expect(pay).toBeTruthy();
    pay.onPress();
    expect(mockPush).toHaveBeenCalledWith('/dues');
  });

  it('refreshes dues so the banner is there once the alert is dismissed', async () => {
    mockMint.mockResolvedValue({ result: 'dues_unpaid', code: null, expires_at: null });
    await generate();
    // Otherwise dismissing returns them to a home screen that still looks as
    // though nothing is wrong.
    await waitFor(() => expect(mockDuesRefresh).toHaveBeenCalled());
  });

  it('names an unexpected result instead of saying "try again"', async () => {
    mockMint.mockResolvedValue({ result: 'code_collision', code: null, expires_at: null });
    await generate();
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [, body] = (Alert.alert as jest.Mock).mock.calls.at(-1);
    // A support message that quotes the actual result is actionable; "it
    // didn't work" is not.
    expect(body).toMatch(/code_collision/);
  });
});
