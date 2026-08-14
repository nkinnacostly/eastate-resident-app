import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Linking, Share } from 'react-native';

import CodeIssued from '@/app/code/[code]';

const EXPIRES = new Date(Date.now() + 5 * 3600_000).toISOString();

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    memberships: [
      { id: 'm1', estate_id: 'estate-1', role: 'resident', estate_name: 'Demo Estate' },
    ],
    activeEstateId: 'estate-1',
  }),
}));

let mockCodes: any[] = [];
jest.mock('@/lib/codes', () => ({
  useCodes: () => ({ codes: mockCodes }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).__router = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
  };
  (global as any).__params = { code: 'B7PJU6' };
  mockCodes = [
    {
      id: 'c1',
      code: 'B7PJU6',
      created_at: new Date().toISOString(),
      expires_at: EXPIRES,
      used_at: null,
      revoked_reason: null,
      status: 'live',
    },
  ];
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
});

describe('code screen', () => {
  it('shows the code and a real expiry resolved from state', () => {
    render(<CodeIssued />);
    expect(screen.getByText('B7PJU6')).toBeTruthy();
    expect(screen.getByText('ONE ENTRY ONLY')).toBeTruthy();
    // REGRESSION: this read "Valid until Invalid Date" when the timestamp came
    // through route params.
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(screen.getByText(/^Valid until /)).toBeTruthy();
  });

  it('degrades gracefully when the code is not in state yet', () => {
    mockCodes = [];
    render(<CodeIssued />);
    expect(screen.getByText('B7PJU6')).toBeTruthy();
    expect(screen.getByText('Valid for 6 hours')).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('copies the bare code, not the whole message', async () => {
    render(<CodeIssued />);
    fireEvent.press(screen.getByText('Copy code'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('B7PJU6'));
    // The gate needs six characters typed in, not a sentence.
    expect(Clipboard.setStringAsync).not.toHaveBeenCalledWith(expect.stringContaining('Demo Estate'));
  });

  it('opens the sheet with a message that stands alone in a chat', () => {
    render(<CodeIssued />);
    fireEvent.press(screen.getByText('Send to visitor'));

    expect(screen.getByText('Send B7PJU6')).toBeTruthy();
    const preview = screen.getByText(/Your code for Demo Estate is B7PJU6/);
    expect(preview).toBeTruthy();
    expect(screen.getByText('WhatsApp')).toBeTruthy();
  });

  it('opens WhatsApp directly when it is installed', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);

    render(<CodeIssued />);
    fireEvent.press(screen.getByText('Send to visitor'));
    fireEvent.press(screen.getByText('WhatsApp'));

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open.mock.calls[0][0]).toContain('whatsapp://send?text=');
    expect(Share.share).not.toHaveBeenCalled();
  });

  // The important one: canOpenURL is false whenever the app isn't installed, so
  // the OS sheet is the common path, not a rare edge case.
  it('falls back to the OS share sheet when WhatsApp is absent', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as any);

    render(<CodeIssued />);
    fireEvent.press(screen.getByText('Send to visitor'));
    fireEvent.press(screen.getByText('WhatsApp'));

    await waitFor(() => expect(Share.share).toHaveBeenCalled());
    expect(open).not.toHaveBeenCalled();
    expect((Share.share as jest.Mock).mock.calls[0][0].message).toContain('B7PJU6');
  });

  describe('dismissing', () => {
    it('goes back when there is history', () => {
      render(<CodeIssued />);
      fireEvent.press(screen.getByLabelText('Close'));

      expect((global as any).__router.back).toHaveBeenCalled();
      expect((global as any).__router.replace).not.toHaveBeenCalled();
    });

    // REGRESSION: this screen is reachable with no history — a deep link or a
    // push notification tap. back() there dispatched GO_BACK at the root and
    // logged "The action 'GO_BACK' was not handled by any navigator."
    it('replaces to the tabs when there is no history', () => {
      (global as any).__router.canGoBack = jest.fn(() => false);

      render(<CodeIssued />);
      fireEvent.press(screen.getByLabelText('Close'));

      expect((global as any).__router.back).not.toHaveBeenCalled();
      expect((global as any).__router.replace).toHaveBeenCalledWith('/(tabs)');
    });
  });

  it('still shares if the scheme check throws', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockRejectedValue(new Error('boom'));

    render(<CodeIssued />);
    fireEvent.press(screen.getByText('Send to visitor'));
    fireEvent.press(screen.getByText('SMS'));

    await waitFor(() => expect(Share.share).toHaveBeenCalled());
  });
});
