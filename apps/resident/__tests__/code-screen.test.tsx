import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { Linking, Share } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import CodeIssued from '@/app/code/[code]';

// Native modules with no JS fallback. The capture is asserted by what it was
// asked to capture (the pass card), and the share by what it was handed.
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(async () => 'file:///tmp/pass.png'),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

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

  describe('QR pass', () => {
    const pass = () => within(screen.getByTestId('visitor-pass'));

    it('puts the QR, the code, the expiry and the privacy link on the pass', () => {
      render(<CodeIssued />);
      expect(pass().getByLabelText('QR code for B 7 P J U 6')).toBeTruthy();
      expect(pass().getByText('B7PJU6')).toBeTruthy();
      expect(pass().getByText('Demo Estate')).toBeTruthy();
      expect(pass().getByText(/^Valid until /)).toBeTruthy();
      expect(pass().getByText('ONE ENTRY ONLY')).toBeTruthy();
      // An image cannot carry a tappable link, so it is printed. Without it a
      // visitor sent only the image never sees what the gate records.
      expect(pass().getByText(/What the gate records: myestateaccess\.com\/privacy/)).toBeTruthy();
    });

    it('carries delivery instructions on the pass itself', () => {
      mockCodes[0] = { ...mockCodes[0], is_delivery: true, delivery_note: 'Leave it with the guard' };
      render(<CodeIssued />);
      expect(pass().getByText('Leave it with the guard')).toBeTruthy();
      expect(pass().getByText('DELIVERY')).toBeTruthy();
    });

    it('sends the pass card as a PNG through the share sheet', async () => {
      render(<CodeIssued />);
      fireEvent.press(screen.getByText('Send to visitor'));
      fireEvent.press(screen.getByText('Send QR pass'));

      await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
      // Captured from the card on screen, so the image cannot differ from it.
      const [target, options] = (captureRef as jest.Mock).mock.calls[0];
      // Under jest the ref holds the mocked View's instance, which carries the
      // props it was rendered with -- enough to say WHICH view was captured.
      expect(target.current?.props?.testID).toBe('visitor-pass');
      expect(options).toMatchObject({ format: 'png', result: 'tmpfile' });
      expect(Sharing.shareAsync).toHaveBeenCalledWith(
        'file:///tmp/pass.png',
        expect.objectContaining({ mimeType: 'image/png' }),
      );
      expect(Share.share).not.toHaveBeenCalled();
    });

    it('falls back to the text message if the image cannot be made', async () => {
      (captureRef as jest.Mock).mockRejectedValueOnce(new Error('view not found'));
      render(<CodeIssued />);
      fireEvent.press(screen.getByText('Send to visitor'));
      fireEvent.press(screen.getByText('Send QR pass'));

      await waitFor(() => expect(Share.share).toHaveBeenCalledTimes(1));
      expect((Share.share as jest.Mock).mock.calls[0][0].message).toContain('B7PJU6');
      expect(Sharing.shareAsync).not.toHaveBeenCalled();
    });

    it('falls back to the text message where file sharing is unavailable', async () => {
      (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
      render(<CodeIssued />);
      fireEvent.press(screen.getByText('Send to visitor'));
      fireEvent.press(screen.getByText('Send QR pass'));

      await waitFor(() => expect(Share.share).toHaveBeenCalledTimes(1));
      expect(captureRef).not.toHaveBeenCalled();
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
