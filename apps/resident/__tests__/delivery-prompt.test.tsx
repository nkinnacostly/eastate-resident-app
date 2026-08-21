import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import Home from '@/app/(tabs)/index';
import { DeliveryPrompt } from '@/components/delivery-prompt';

// jest.mock factories are hoisted, so anything they close over must be
// `mock`-prefixed.
const mockPush = jest.fn();
const mockMint = jest.fn();

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
  live: [],
  loading: false,
  refresh: jest.fn(),
  mint: mockMint,
});
jest.mock('@/lib/codes', () => ({
  useCodes: () => mockCodesState(),
  useCodesOnFocus: () => mockCodesState(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).__router = { push: mockPush };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockMint.mockResolvedValue({ result: 'ok', code: 'B7PJU6', expires_at: '2026-08-20T23:00:00Z' });
});

const openPrompt = () => {
  render(<Home />);
  fireEvent.press(screen.getByText('Generate code'));
};

describe('the delivery question', () => {
  it('is asked before anything is minted', () => {
    openPrompt();
    expect(screen.getByText('Is this code for a delivery?')).toBeTruthy();
    // The whole point of asking first: is_delivery is written by the same
    // statement that inserts the row, so it cannot be amended afterwards.
    expect(mockMint).not.toHaveBeenCalled();
  });

  it('mints a plain code with no delivery state when the answer is no', async () => {
    openPrompt();
    fireEvent.press(screen.getByText('No, a visitor'));
    await waitFor(() => expect(mockMint).toHaveBeenCalledTimes(1));
    expect(mockMint).toHaveBeenCalledWith({ isDelivery: false });
    // "No" must stay a two-tap path — it must not detour via the note sheet.
    expect(screen.queryByTestId('delivery-note-input')).toBeNull();
  });

  it('opens the note sheet instead of minting when the answer is yes', () => {
    openPrompt();
    fireEvent.press(screen.getByText('Yes, it is a delivery'));
    expect(screen.getByTestId('delivery-note-input')).toBeTruthy();
    expect(mockMint).not.toHaveBeenCalled();
  });

  it('passes the typed instructions through to the mint', async () => {
    openPrompt();
    fireEvent.press(screen.getByText('Yes, it is a delivery'));
    fireEvent.changeText(screen.getByTestId('delivery-note-input'), 'Leave at the gate, house 14');
    fireEvent.press(screen.getByText('Generate code'));
    await waitFor(() => expect(mockMint).toHaveBeenCalledTimes(1));
    expect(mockMint).toHaveBeenCalledWith({
      isDelivery: true,
      note: 'Leave at the gate, house 14',
    });
  });

  it('still mints a delivery code when no instructions are typed', async () => {
    openPrompt();
    fireEvent.press(screen.getByText('Yes, it is a delivery'));
    fireEvent.press(screen.getByText('Generate code'));
    await waitFor(() => expect(mockMint).toHaveBeenCalledTimes(1));
    expect(mockMint).toHaveBeenCalledWith({ isDelivery: true, note: '' });
  });

  it('navigates to the code screen once a delivery code is minted', async () => {
    openPrompt();
    fireEvent.press(screen.getByText('Yes, it is a delivery'));
    fireEvent.changeText(screen.getByTestId('delivery-note-input'), 'Ring the bell twice');
    fireEvent.press(screen.getByText('Generate code'));
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/code/[code]',
        params: { code: 'B7PJU6' },
      }),
    );
  });

  it('can go back from the note sheet to the question', () => {
    openPrompt();
    fireEvent.press(screen.getByText('Yes, it is a delivery'));
    fireEvent.press(screen.getByText('Back'));
    expect(screen.getByText('Is this code for a delivery?')).toBeTruthy();
  });

  it('explains an over-long note rather than failing silently', async () => {
    mockMint.mockResolvedValue({ result: 'note_too_long', code: null, expires_at: null });
    openPrompt();
    fireEvent.press(screen.getByText('Yes, it is a delivery'));
    fireEvent.press(screen.getByText('Generate code'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toMatch(/too long/i);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not carry a previous answer into the next code', async () => {
    // A resident who backs out mid-delivery and taps Generate again must not
    // find the sheet still open holding text for a code that never existed.
    openPrompt();
    fireEvent.press(screen.getByText('Yes, it is a delivery'));
    fireEvent.changeText(screen.getByTestId('delivery-note-input'), 'stale text');
    fireEvent.press(screen.getByLabelText('Dismiss'));
    fireEvent.press(screen.getByText('Generate code'));
    expect(screen.getByText('Is this code for a delivery?')).toBeTruthy();
  });
});

describe('DeliveryPrompt in isolation', () => {
  it('counts down the characters left', () => {
    render(<DeliveryPrompt visible onCancel={jest.fn()} onSubmit={jest.fn()} />);
    fireEvent.press(screen.getByText('Yes, it is a delivery'));
    expect(screen.getByText('200 characters left')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('delivery-note-input'), 'abcde');
    expect(screen.getByText('195 characters left')).toBeTruthy();
  });

  it('cannot be dismissed mid-mint', () => {
    const onCancel = jest.fn();
    render(<DeliveryPrompt visible busy onCancel={onCancel} onSubmit={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
