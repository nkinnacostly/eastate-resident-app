import { render, screen } from '@testing-library/react-native';

import Dues from '@/app/(tabs)/dues';
import type { DuesStatus } from '@/lib/dues-status';

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    activeEstateId: 'estate-1',
    memberships: [{ id: 'm1', estate_id: 'estate-1', estate_name: 'Demo Estate' }],
  }),
}));

jest.mock('@/lib/api', () => ({ startDuesPayment: jest.fn() }));

let mockStatus: DuesStatus;
jest.mock('@/lib/dues-status', () => ({ useDuesStatus: () => mockStatus }));

const charge = (over: Record<string, unknown> = {}) => ({
  charge_id: 'c1',
  period: '2026-09-01',
  amount_minor: 250000,
  currency: 'NGN',
  due_on: '2026-09-08',
  status: 'open',
  is_overdue: false,
  billing_mode: 'per_resident',
  subject: 'resident',
  pay_token: 'tok',
  landlord_name: null,
  landlord_phone: null,
  landlord_email: null,
  enforcement_on: false,
  ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  billing_mode: 'per_resident',
  monthly_minor: 250000,
  currency: 'NGN',
  grace_days: 7,
  enforcement_on: false,
  outstanding_minor: 0,
  outstanding_count: 0,
  overdue_minor: 0,
  overdue_count: 0,
  paid_count: 0,
  blocked: false,
  next_period: '2026-10-01',
  next_due_on: '2026-10-08',
  ...over,
});

const state = (over: Partial<DuesStatus> = {}): DuesStatus => ({
  summary: summary() as never,
  all: [],
  settled: [],
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

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = state();
});

// ★ The case the summary RPC exists for. An estate that bills but has raised
// no charges returns an EMPTY LIST, and a list-driven screen would tell a
// resident who owes from the 1st that there is nothing here.
it('states the terms even when no charge has been raised yet', () => {
  mockStatus = state({ all: [], outstanding: [], settled: [] });
  render(<Dues />);
  expect(screen.getByText('NEXT PAYMENT')).toBeTruthy();
  expect(screen.getByText(/₦2,500/)).toBeTruthy();
  expect(screen.getByText(/October 2026/)).toBeTruthy();
  // And says WHEN, in days the resident can act on.
  expect(screen.getByText(/7 days after the 1st/)).toBeTruthy();
});

it('separates what is due from what is settled', () => {
  const open = charge({ charge_id: 'open1' });
  const paid = charge({ charge_id: 'paid1', status: 'paid', period: '2026-08-01' });
  mockStatus = state({
    all: [open, paid] as never,
    outstanding: [open] as never,
    settled: [paid] as never,
    totalOwedMinor: 250000,
    summary: summary({ outstanding_minor: 250000, outstanding_count: 1, paid_count: 1 }) as never,
  });
  render(<Dues />);
  expect(screen.getByText('To pay')).toBeTruthy();
  expect(screen.getByText('History')).toBeTruthy();
  expect(screen.getByText('Paid')).toBeTruthy();
  // The action belongs only to the open one — a Pay button on a settled month
  // is an invitation to pay twice.
  expect(screen.getAllByText(/^Pay ₦2,500$/)).toHaveLength(1);
});

it('says codes are paused only when they actually are', () => {
  const late = charge({ is_overdue: true, enforcement_on: true });
  mockStatus = state({
    all: [late] as never, outstanding: [late] as never, overdue: [late] as never,
    blocked: true, totalOwedMinor: 250000,
    summary: summary({ blocked: true, enforcement_on: true, overdue_count: 1,
                       outstanding_minor: 250000 }) as never,
  });
  render(<Dues />);
  expect(screen.getByText('CODES PAUSED')).toBeTruthy();
  // The two reassurances, on this screen as well as the banner.
  expect(screen.getByText(/own access to the estate is unaffected/i)).toBeTruthy();
  expect(screen.getByText(/already shared still work/i)).toBeTruthy();
});

it('leads a tenant with handing the bill over, not paying it', () => {
  const houseCharge = charge({
    billing_mode: 'per_house', is_overdue: true, enforcement_on: true,
    landlord_name: 'Mr Okon', landlord_phone: '+2348000000000',
  });
  mockStatus = state({
    all: [houseCharge] as never, outstanding: [houseCharge] as never,
    overdue: [houseCharge] as never, blocked: true, totalOwedMinor: 250000,
    summary: summary({ billing_mode: 'per_house', blocked: true,
                       outstanding_minor: 250000, overdue_count: 1 }) as never,
  });
  render(<Dues />);
  expect(screen.getByText('Send this bill to the landlord')).toBeTruthy();
  expect(screen.getByText(/Pay it yourself/)).toBeTruthy();
  // And whose bill it actually is, stated plainly.
  expect(screen.getByText(/owner’s to pay, not yours/i)).toBeTruthy();
});

it('says so plainly when the estate does not bill at all', () => {
  mockStatus = state({ summary: summary({ billing_mode: 'none', monthly_minor: null,
                                          next_period: null, next_due_on: null }) as never });
  render(<Dues />);
  expect(screen.getByText(/does not collect dues through this app/i)).toBeTruthy();
  expect(screen.queryByText('NEXT PAYMENT')).toBeNull();
});
