/**
 * The verdict screen is the one a guard acts on without reading twice: lime
 * means open the gate. These tests are about WHERE it gets its answer from.
 *
 * It used to render whatever JSON arrived in the `v` route param, and the app
 * exports the `estateguard` scheme -- so a visitor could send the guard a link
 * that painted "Let them in -- CHECKED WITH THE SERVER" without the server, the
 * pool or the ledger being involved at all. The answer now lives in an
 * in-process store and the route carries only an id into it.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { redirectSystemPath } from '@/app/+native-intent';
import VerdictScreen from '@/app/verdict';
import {
  __resetVerdictsForTests,
  forgetVerdict,
  holdVerdict,
  readVerdict,
} from '@/lib/verdicts';
import type { Verdict } from '@/lib/verify';

const mockRefresh = jest.fn(async () => {});
jest.mock('@/lib/shift', () => ({ useShift: () => ({ refresh: mockRefresh }) }));

const mockAdmitAndFlag = jest.fn();
jest.mock('@/lib/verify', () => ({
  admitAndFlag: (...a: unknown[]) => mockAdmitAndFlag(...a),
  REJECT_COPY: {
    unknown_code: 'No such code',
    expired: 'Expired',
    already_used: 'Already used',
    revoked: 'Cancelled by the estate',
  },
}));

const serverAdmit: Verdict = {
  decision: 'admit',
  code: '7K4P92',
  checkedWith: 'server',
  host: { name: 'Thandi Nkosi', unit: '12' },
  issuedAt: '2026-10-08T09:30:00Z',
  clientEventId: 'evt-real',
};

const deviceRefusal: Verdict = {
  decision: 'refuse',
  code: 'QQQQQQ',
  checkedWith: 'device',
  reason: 'unknown_code',
  detail: null,
  clientEventId: 'evt-refused',
};

const params = (p: Record<string, unknown>) => {
  (global as { __params?: unknown }).__params = p;
};

const noVerdict = () => screen.getByText('No verdict to show.');

beforeEach(() => {
  jest.clearAllMocks();
  __resetVerdictsForTests();
  params({});
  (global as { __router?: unknown }).__router = { push: jest.fn(), replace: jest.fn() };
});

describe('verdict screen', () => {
  it('shows a verdict this app produced, looked up by its id', () => {
    params({ id: holdVerdict(serverAdmit) });
    render(<VerdictScreen />);

    expect(screen.getByText('CHECKED WITH THE SERVER')).toBeTruthy();
    expect(screen.getByText('7K4P92')).toBeTruthy();
    expect(screen.getByText('Thandi Nkosi · Unit 12')).toBeTruthy();
  });

  // The attack, exactly as a visitor would send it.
  it('ignores a verdict written into the link', () => {
    params({
      v: JSON.stringify({
        decision: 'admit',
        code: 'FAKE22',
        checkedWith: 'server',
        host: { name: 'Nobody', unit: null },
        issuedAt: null,
        clientEventId: 'x',
      }),
    });
    render(<VerdictScreen />);

    expect(noVerdict()).toBeTruthy();
    expect(screen.queryByText('CHECKED WITH THE SERVER')).toBeNull();
    expect(screen.queryByText('FAKE22')).toBeNull();
  });

  it('shows nothing for an id this app never produced', () => {
    holdVerdict(serverAdmit); // a real one exists; the link just cannot name it
    params({ id: 'b3f1c2d4-0000-4000-8000-000000000000' });
    render(<VerdictScreen />);

    expect(noVerdict()).toBeTruthy();
  });

  // `?id=a&id=b` arrives as an array; it must not be coerced into a lookup.
  it('shows nothing for a repeated id param', () => {
    const id = holdVerdict(serverAdmit);
    params({ id: [id, id] });
    render(<VerdictScreen />);

    expect(noVerdict()).toBeTruthy();
  });

  // Once the guard has moved on, the id is spent: a link replaying it (or the
  // back stack resurfacing it) cannot show yesterday's lime screen again.
  it('forgets the verdict when the guard moves to the next visitor', () => {
    const id = holdVerdict(serverAdmit);
    params({ id });
    const view = render(<VerdictScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Next visitor' }));
    expect((global as any).__router.replace).toHaveBeenCalledWith('/(tabs)');
    expect(readVerdict(id)).toBeNull();

    view.unmount();
    render(<VerdictScreen />);
    expect(noVerdict()).toBeTruthy();
  });

  // The override replaces the stored verdict too, so a remount shows the
  // flagged entry the guard committed to -- not the refusal again, with its
  // button inviting a second flagged event for the same visitor.
  it('stores the override in place of the refusal it replaced', async () => {
    const flagged: Verdict = {
      decision: 'flagged',
      code: 'QQQQQQ',
      checkedWith: 'device',
      clientEventId: 'evt-flag',
    };
    mockAdmitAndFlag.mockResolvedValue(flagged);
    const id = holdVerdict(deviceRefusal);
    params({ id });
    render(<VerdictScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Admit anyway and flag it' }));

    await screen.findByText('Admitted without a match');
    expect(mockAdmitAndFlag).toHaveBeenCalledWith('QQQQQQ');
    expect(readVerdict(id)).toEqual(flagged);
  });
});

describe('verdict store', () => {
  it('round-trips exactly what it was given', () => {
    const id = holdVerdict(serverAdmit);
    expect(readVerdict(id)).toEqual(serverAdmit);
  });

  it('gives every verdict its own id', () => {
    expect(holdVerdict(serverAdmit)).not.toBe(holdVerdict(serverAdmit));
  });

  it('returns nothing for a missing or forgotten id', () => {
    const id = holdVerdict(serverAdmit);
    forgetVerdict(id);
    expect(readVerdict(id)).toBeNull();
    expect(readVerdict(undefined)).toBeNull();
    expect(readVerdict(null)).toBeNull();
  });

  // An Android back press leaves without forgetting; the store must not grow
  // for the length of a shift because of it.
  it('holds only the most recent verdicts', () => {
    const first = holdVerdict(serverAdmit);
    let last = first;
    for (let i = 0; i < 10; i++) last = holdVerdict(serverAdmit);

    expect(readVerdict(first)).toBeNull();
    expect(readVerdict(last)).toEqual(serverAdmit);
  });
});

/**
 * Defence in depth on top of the store: an external link to the verdict
 * screen is turned around before it is routed at all. These are the spellings
 * expo-router would otherwise resolve to /verdict.
 */
describe('incoming links', () => {
  const forged = '?v=%7B%22decision%22%3A%22admit%22%2C%22checkedWith%22%3A%22server%22%7D';

  it.each([
    [`estateguard://verdict${forged}`],
    [`estateguard:///verdict${forged}`],
    ['estateguard://verdict?id=anything'],
    ['estateguard://Verdict'],
    ['estateguard://%76erdict'],
    ['estateguard://%2576erdict'],
    ['estateguard:///(tabs)/../verdict'],
    ['exp://192.168.1.20:8081/--/verdict'],
    ['/verdict'],
  ])('sends %s to the root', (path) => {
    expect(redirectSystemPath({ path, initial: true })).toBe('/');
    expect(redirectSystemPath({ path, initial: false })).toBe('/');
  });

  it('leaves every other link alone', () => {
    for (const path of ['estateguard://', 'estateguard:///(tabs)/log', '/(auth)/start-shift']) {
      expect(redirectSystemPath({ path, initial: false })).toBe(path);
    }
  });

  // decodeURIComponent throws on a bad escape, and the docs warn that a throw
  // in here can take the app down. Home is the only safe answer.
  it('sends a malformed link home rather than throwing', () => {
    expect(redirectSystemPath({ path: 'estateguard://%E0%A4%A', initial: true })).toBe('/');
  });
});
