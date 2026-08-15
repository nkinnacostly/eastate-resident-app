import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AppState } from 'react-native';

import { CodesProvider, useCodesOnFocus } from '@/lib/codes';

const mockList = jest.fn();
jest.mock('@/lib/api', () => ({
  listMyCodes: () => mockList(),
  mintCode: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, activeEstateId: 'estate-1' }),
}));

function Screen() {
  const { live } = useCodesOnFocus();
  return <Text>{`live:${live.length}`}</Text>;
}

const liveRow = (code: string) => ({
  id: code,
  code,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  used_at: null,
  revoked_reason: null,
  status: 'live' as const,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue([liveRow('B7PJU6')]);
});

/**
 * REGRESSION: the list loaded once and never again, so a code burned at the
 * gate kept showing as live — the app misreporting the one fact it exists to
 * report.
 */
describe('code freshness', () => {
  it('loads codes on first render', async () => {
    render(
      <CodesProvider>
        <Screen />
      </CodesProvider>,
    );
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
  });

  // The case that actually bites: phone in a pocket while a guard burns the
  // code, then the resident reopens the app.
  it('refetches when the app returns to the foreground', async () => {
    render(
      <CodesProvider>
        <Screen />
      </CodesProvider>,
    );
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));

    const handler = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1];
    expect(handler).toBeInstanceOf(Function);

    await act(async () => handler('active'));

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('does not refetch when the app merely goes to the background', async () => {
    render(
      <CodesProvider>
        <Screen />
      </CodesProvider>,
    );
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));

    const handler = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1];
    await act(async () => handler('background'));

    expect(mockList).toHaveBeenCalledTimes(1);
  });

  // A transient failure must not blank a list the resident may be reading a
  // code off right now.
  it('keeps the last known list when a refetch fails', async () => {
    const { getByText } = render(
      <CodesProvider>
        <Screen />
      </CodesProvider>,
    );
    await waitFor(() => expect(getByText('live:1')).toBeTruthy());

    mockList.mockRejectedValueOnce(new Error('offline'));
    const handler = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1];
    await act(async () => handler('active'));

    expect(getByText('live:1')).toBeTruthy();
  });
});
