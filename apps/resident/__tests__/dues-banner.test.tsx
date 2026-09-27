import { fireEvent, render, screen } from '@testing-library/react-native';

import { DuesBanner } from '@/components/dues-banner';
import type { DuesStatus } from '@/lib/dues-status';

/**
 * The banner exists because of a reported dead end: a resident with overdue
 * dues pressed Generate and got "Could not generate a code. Please try again."
 * Trying again could never work, and nothing beforehand said a penny was owed.
 *
 * The property under test is therefore not "does it render" but "does it say
 * the RIGHT thing", because there are two states and the wrong words in either
 * are worse than silence: telling a resident codes are paused when they are
 * not is a lie the next tap disproves.
 */
const mockPush = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  (global as any).__router = { push: mockPush };
});

const status = (over: Partial<DuesStatus> = {}): DuesStatus => ({
  overdue: [],
  outstanding: [],
  totalOwedMinor: 0,
  currency: 'NGN',
  blocked: false,
  owesButNotBlocked: false,
  loading: false,
  refresh: jest.fn(),
  ...over,
});

it('says nothing when nothing is owed', () => {
  const { toJSON } = render(<DuesBanner status={status()} />);
  expect(toJSON()).toBeNull();
});

it('names the amount and the consequence when codes are paused', () => {
  render(<DuesBanner status={status({ blocked: true, totalOwedMinor: 250000 })} />);
  expect(screen.getByText('CODES PAUSED')).toBeTruthy();
  // The amount must be on screen. "You owe dues" without a figure is the kind
  // of vagueness that sends someone to the estate office instead of paying.
  expect(screen.getByText(/₦2,500/)).toBeTruthy();
  expect(screen.getByText(/cannot make new visitor codes/i)).toBeTruthy();
});

it('promises the two things a blocked resident is actually afraid of', () => {
  render(<DuesBanner status={status({ blocked: true, totalOwedMinor: 100 })} />);
  // Being locked out of your own home, and codes already given to a visitor
  // dying in their pocket. Neither happens, and saying so is the difference
  // between a bill and a threat.
  expect(screen.getByText(/own access to the estate is not affected/i)).toBeTruthy();
  expect(screen.getByText(/already shared still work/i)).toBeTruthy();
});

it('does NOT claim codes are paused when the estate does not enforce', () => {
  render(<DuesBanner status={status({ owesButNotBlocked: true, totalOwedMinor: 100 })} />);
  expect(screen.getByText('DUES OUTSTANDING')).toBeTruthy();
  expect(screen.queryByText('CODES PAUSED')).toBeNull();
  expect(screen.getByText(/Codes still work/i)).toBeTruthy();
});

it('is entirely tappable, not just a small link', () => {
  render(<DuesBanner status={status({ blocked: true, totalOwedMinor: 100 })} />);
  fireEvent.press(screen.getByText(/cannot make new visitor codes/i));
  expect(mockPush).toHaveBeenCalledWith('/dues');
});
