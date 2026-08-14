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

jest.mock('@/lib/codes', () => ({
  useCodes: () => ({ live: mockLive, loading: false, refresh: jest.fn(), mint: mockMint }),
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

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(tabs)/codes'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('explains a rate limit without navigating', async () => {
    mockMint.mockResolvedValue({ result: 'rate_limited', code: null, expires_at: null });
    render(<Home />);

    fireEvent.press(screen.getByText('Generate code'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Slow down', expect.any(String)),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('surfaces a thrown error instead of crashing', async () => {
    mockMint.mockRejectedValue(new Error('network down'));
    render(<Home />);

    fireEvent.press(screen.getByText('Generate code'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Could not generate a code', 'network down'),
    );
  });
});
