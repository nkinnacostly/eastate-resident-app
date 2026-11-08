/**
 * The QR scanner, driven through the REAL check path.
 *
 * Only the edges are faked: the camera (which cannot run under jest), SQLite
 * and the Supabase client. lib/check and lib/verify run for real, so these
 * tests prove what a scan actually does at the gate -- including the question
 * this feature was built to answer: with no signal, a scanned code is checked
 * against the pool on the phone and burned there, exactly like a typed one.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import Scan from '@/app/scan';
import { readVerdict } from '@/lib/verdicts';

// ── Camera ───────────────────────────────────────────────────────────────────

type Permission = { granted: boolean; canAskAgain: boolean; status: string };
let mockPermission: Permission | null = null;
const mockRequestPermission = jest.fn(async () => mockPermission);
let mockCameraProps: Record<string, any> | null = null;

jest.mock('expo-camera', () => ({
  CameraView: (props: Record<string, any>) => {
    mockCameraProps = props;
    return null;
  },
  useCameraPermissions: () => [mockPermission, mockRequestPermission, jest.fn()],
}));

/** What the camera does when a QR comes into view: report it, frame after frame. */
const showQr = async (data: string, frames = 1) => {
  await act(async () => {
    for (let i = 0; i < frames; i++) {
      mockCameraProps!.onBarcodeScanned({ type: 'qr', data });
    }
  });
};

// ── Shift ────────────────────────────────────────────────────────────────────

const mockShift = {
  post: { membership_id: 'm-1', estate_id: 'e-1', estate_name: 'Acacia Park' } as unknown,
  online: true,
  authorisationExpired: false,
  refresh: jest.fn(async () => {}),
};
jest.mock('@/lib/shift', () => ({ useShift: () => mockShift }));

// ── Pool on the phone (SQLite) ───────────────────────────────────────────────

const mockDb = {
  pool: [] as { id: string; code: string; expires_at: string }[],
  burned: [] as string[],
  enqueued: [] as any[],
  lastPullAt: null as string | null,
};
jest.mock('@/lib/db', () => ({
  findInPool: jest.fn(async (code: string) => {
    const hit = mockDb.pool.find((c) => c.code === code);
    return hit && new Date(hit.expires_at).getTime() > Date.now() ? hit : null;
  }),
  findInPoolIgnoringExpiry: jest.fn(
    async (code: string) => mockDb.pool.find((c) => c.code === code) ?? null,
  ),
  burnLocally: jest.fn(async (id: string) => {
    mockDb.burned.push(id);
    mockDb.pool = mockDb.pool.filter((c) => c.id !== id);
  }),
  enqueue: jest.fn(async (row: any, synced: 0 | 1 = 0) => {
    mockDb.enqueued.push({ ...row, synced });
  }),
  getMeta: jest.fn(async (k: string) => (k === 'last_pull_at' ? mockDb.lastPullAt : null)),
}));

// ── Server ───────────────────────────────────────────────────────────────────

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => mockRpc(...a) } }));

const ADMITTED = {
  outcome: 'admitted',
  code_id: 'code-1',
  reject_reason: null,
  verified_at: '2026-11-08T18:00:00Z',
  host_name: 'Ada Obi',
  host_unit: '14B',
  collision: false,
};

const router = () => (global as any).__router as Record<string, jest.Mock>;
const lastVerdict = () => {
  const [{ pathname, params }] = router().replace.mock.calls.at(-1)!;
  expect(pathname).toBe('/verdict');
  return readVerdict(params.id);
};

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).__resetUuidSeq();
  (global as any).__router = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
  };
  mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
  mockCameraProps = null;
  mockShift.online = true;
  mockShift.authorisationExpired = false;
  mockShift.post = { membership_id: 'm-1', estate_id: 'e-1', estate_name: 'Acacia Park' };
  mockDb.pool = [
    { id: 'code-1', code: '7K4P92', expires_at: new Date(Date.now() + 3 * 3600_000).toISOString() },
  ];
  mockDb.burned = [];
  mockDb.enqueued = [];
  mockDb.lastPullAt = new Date(Date.now() - 20 * 60_000).toISOString();
  mockRpc.mockResolvedValue({ data: [ADMITTED], error: null });
});

describe('scanning with no signal', () => {
  beforeEach(() => {
    mockShift.online = false;
  });

  it('checks a scanned code against the pool on the phone and burns it there', async () => {
    render(<Scan />);
    await showQr('7K4P92');

    await waitFor(() => expect(router().replace).toHaveBeenCalledTimes(1));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockDb.burned).toEqual(['code-1']);
    expect(mockDb.enqueued).toEqual([
      expect.objectContaining({ code: '7K4P92', outcome: 'admitted', synced: 0 }),
    ]);
    expect(lastVerdict()).toMatchObject({ decision: 'admit', checkedWith: 'device' });
  });

  it('refuses a code the phone has never seen, and logs the refusal', async () => {
    render(<Scan />);
    await showQr('ZZZZZZ');

    await waitFor(() => expect(router().replace).toHaveBeenCalledTimes(1));
    expect(lastVerdict()).toMatchObject({ decision: 'refuse', reason: 'unknown_code' });
    expect(mockDb.enqueued).toEqual([
      expect.objectContaining({ code: 'ZZZZZZ', outcome: 'rejected', reject_reason: 'unknown_code' }),
    ]);
  });

  it('says it is checking on the phone rather than the server', async () => {
    let finish!: () => void;
    const { findInPool } = jest.requireMock('@/lib/db');
    findInPool.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve(null))),
    );
    render(<Scan />);
    await showQr('7K4P92');
    expect(screen.getByText('Checking 7K4P92 on this phone…')).toBeTruthy();
    await act(async () => finish());
  });

  it('will not open the camera once the phone has been out of contact past a code’s life', () => {
    mockShift.authorisationExpired = true;
    render(<Scan />);
    expect(mockCameraProps).toBeNull();
    expect(screen.getByText(/out of contact for longer than a code lasts/)).toBeTruthy();
  });
});

describe('scanning with signal', () => {
  it('sends the scanned code to the server and shows the server’s verdict', async () => {
    render(<Scan />);
    await showQr('7K4P92');

    await waitFor(() => expect(router().replace).toHaveBeenCalledTimes(1));
    expect(mockRpc).toHaveBeenCalledWith('verify_access_code', {
      p_estate_id: 'e-1',
      p_code: '7K4P92',
      p_client_event_id: 'evt-1',
    });
    expect(lastVerdict()).toMatchObject({
      decision: 'admit',
      checkedWith: 'server',
      host: { name: 'Ada Obi', unit: '14B' },
    });
    // Mirrored into the phone's ledger as already synced, never re-sent.
    expect(mockDb.enqueued).toEqual([expect.objectContaining({ synced: 1 })]);
  });

  it('falls back to the phone when the server drops mid-check', async () => {
    mockRpc.mockRejectedValueOnce(new Error('Network request failed'));
    render(<Scan />);
    await showQr('7K4P92');

    await waitFor(() => expect(router().replace).toHaveBeenCalledTimes(1));
    expect(lastVerdict()).toMatchObject({ decision: 'admit', checkedWith: 'device' });
    expect(mockDb.burned).toEqual(['code-1']);
  });
});

describe('reading the QR', () => {
  it('checks a QR once however many frames report it', async () => {
    render(<Scan />);
    await showQr('7K4P92', 8);

    await waitFor(() => expect(router().replace).toHaveBeenCalledTimes(1));
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('accepts a code in any case and with stray whitespace', async () => {
    render(<Scan />);
    await showQr(' 7k4p92\n');

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1));
    expect(mockRpc.mock.calls[0][1].p_code).toBe('7K4P92');
  });

  it('turns away a foreign QR without logging a gate attempt, then reads a real one', async () => {
    render(<Scan />);
    await showQr('https://example.com/pass/7K4P92', 5);

    expect(screen.getByText('That QR is not a visitor code. Ask for the code instead.')).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockDb.enqueued).toEqual([]);
    const haptics = jest.requireMock('expo-haptics');
    expect(haptics.notificationAsync).toHaveBeenCalledTimes(1); // once, not per frame

    await showQr('7K4P92');
    await waitFor(() => expect(router().replace).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['too short', '7K4P9'],
    ['too long', '7K4P922'],
    ['a glyph no code contains', '7K4P9O'],
  ])('does not check a QR that is %s', async (_label, data) => {
    render(<Scan />);
    await showQr(data);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockDb.enqueued).toEqual([]);
  });

  it('decodes QR codes only', () => {
    render(<Scan />);
    expect(mockCameraProps!.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });
  });

  it('holds still after a failed check until the guard asks to scan again', async () => {
    mockRpc.mockRejectedValue(new Error('Network request failed'));
    const { findInPool } = jest.requireMock('@/lib/db');
    findInPool.mockRejectedValueOnce(new Error('database is locked'));
    render(<Scan />);
    await showQr('7K4P92');

    await screen.findByText('Could not check 7K4P92. Network request failed');
    await showQr('7K4P92', 3); // still in front of the camera
    expect(mockRpc).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('Scan again'));
    mockRpc.mockResolvedValue({ data: [ADMITTED], error: null });
    await showQr('7K4P92');
    await waitFor(() => expect(router().replace).toHaveBeenCalledTimes(1));
  });

  it('switches the torch for a printed pass', () => {
    render(<Scan />);
    expect(mockCameraProps!.enableTorch).toBe(false);
    fireEvent.press(screen.getByLabelText('Turn torch on'));
    expect(mockCameraProps!.enableTorch).toBe(true);
  });
});

describe('camera permission', () => {
  it('asks once on arrival, not again when the answer comes back', async () => {
    mockPermission = { granted: false, canAskAgain: true, status: 'undetermined' };
    const { rerender } = render(<Scan />);
    mockPermission = { granted: false, canAskAgain: true, status: 'denied' };
    rerender(<Scan />);
    await waitFor(() => expect(mockRequestPermission).toHaveBeenCalledTimes(1));
    expect(mockCameraProps).toBeNull();
  });

  // Seen on the simulator: with no post the screen said it could not check
  // anything, and the OS camera prompt came up over that message anyway.
  it('does not ask for the camera on a phone that cannot check codes', async () => {
    mockPermission = { granted: false, canAskAgain: true, status: 'undetermined' };
    mockShift.post = null;
    render(<Scan />);
    await act(async () => {});
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('sends the guard to Settings once the OS will not ask again', () => {
    mockPermission = { granted: false, canAskAgain: false, status: 'denied' };
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    render(<Scan />);

    expect(mockRequestPermission).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Allow camera'));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('always leaves a way back to the keypad', () => {
    mockPermission = { granted: false, canAskAgain: false, status: 'denied' };
    render(<Scan />);
    fireEvent.press(screen.getByText('Type the code instead'));
    expect(router().back).toHaveBeenCalledTimes(1);
  });
});
