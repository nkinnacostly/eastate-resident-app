import { render, screen } from '@testing-library/react-native';

import You from '@/app/(tabs)/you';

let mockAuth: any;

jest.mock('@/lib/auth', () => ({
  useAuth: () => mockAuth,
}));

const membership = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  estate_id: 'estate-1',
  role: 'resident',
  estate_name: 'Demo Estate',
  unit: 'B12',
  ...over,
});

beforeEach(() => {
  mockAuth = {
    session: {
      user: {
        email: 'rita@example.com',
        // What the applicant TYPED at sign-up — a claim, not a fact.
        user_metadata: { full_name: 'Rita Resident', requested_unit: 'Z99' },
      },
    },
    memberships: [membership()],
    activeEstateId: 'estate-1',
    setActiveEstateId: jest.fn(),
    signOut: jest.fn(),
  };
});

describe('You', () => {
  it('shows the unit the admin assigned on the membership', () => {
    render(<You />);
    // Twice, deliberately: once in the header beside the email, once on the
    // estate row it belongs to.
    expect(screen.getByText(/rita@example\.com · Unit B12/)).toBeTruthy();
    expect(screen.getByText(/resident · Unit B12/)).toBeTruthy();
  });

  // The whole reason unit moved out of user_metadata: metadata is
  // self-asserted, so rendering it would tell a resident they live somewhere
  // the estate has no record of.
  it('never shows the self-asserted unit from user_metadata', () => {
    mockAuth.memberships = [membership({ unit: null })];
    render(<You />);

    expect(screen.queryByText(/Z99/)).toBeNull();
    expect(screen.queryByText(/Unit/)).toBeNull();
  });

  it('shows each estate its own unit, not the active one', () => {
    mockAuth.memberships = [
      membership(),
      membership({ id: 'm2', estate_id: 'estate-2', estate_name: 'Kelvin Grove', unit: 'A4' }),
    ];
    render(<You />);

    expect(screen.getByText(/resident · Unit B12/)).toBeTruthy();
    expect(screen.getByText(/resident · Unit A4/)).toBeTruthy();
  });

  it('omits the unit for a membership that has none', () => {
    mockAuth.memberships = [membership({ unit: null })];
    render(<You />);

    expect(screen.getByText('resident')).toBeTruthy();
  });

  it('explains the empty state when no estate has approved them', () => {
    mockAuth.memberships = [];
    mockAuth.activeEstateId = null;
    render(<You />);

    expect(screen.getByText(/No estate access yet/)).toBeTruthy();
  });
});
