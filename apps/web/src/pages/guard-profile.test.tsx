import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GuardProfile as Profile } from '../lib/api';
import { GuardProfile } from './guard-profile';

afterEach(cleanup);

vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({ activeEstateId: 'est-1', activeEstate: { estate_name: 'Palm Court' } }),
}));
const api = vi.hoisted(() => ({
  getGuardProfile: vi.fn(),
  listGuardShifts: vi.fn(async () => []),
  listEvents: vi.fn(async () => []),
  isFlagged: () => false,
}));
vi.mock('../lib/api', () => api);

const PROFILE: Profile = {
  membership_id: 'm-1',
  user_id: 'u-1',
  full_name: 'Musa Bello',
  phone: null,
  email: 'musa@example.com',
  is_active: true,
  joined_at: '2026-09-01T08:00:00Z',
  last_sign_in_at: null,
  agency_name: null,
  licence_number: null,
  licence_grade: null,
  licence_expires_at: null,
  licence_verified_at: null,
  on_duty_since: null,
  shifts_30d: 0,
  hours_on_duty_30d: 0,
  last_shift_at: null,
  verifications_30d: 0,
  admitted_30d: 0,
  rejected_30d: 0,
  offline_30d: 0,
  flagged_30d: 0,
  last_verification_at: null,
};

function show(profile: Profile) {
  api.getGuardProfile.mockResolvedValue(profile);
  return render(
    <MemoryRouter initialEntries={['/guards/m-1']}>
      <Routes>
        <Route path="/guards/:membershipId" element={<GuardProfile />} />
      </Routes>
    </MemoryRouter>,
  );
}

// An estate admin's view has no agency regulator to go on, and the estates are
// Nigerian: the licence is a licence, never a "PSIRA number".
describe("an estate admin's guard profile", () => {
  it('labels the licence plainly and shows no grade a Nigerian licence does not have', async () => {
    const { container } = show(PROFILE);
    await screen.findByText('Musa Bello');
    expect(screen.getByText('LICENCE NUMBER')).toBeTruthy();
    expect(screen.queryByText('GRADE')).toBeNull();
    expect(container.textContent).not.toMatch(/PSIRA/);
  });

  it('still shows a grade when one was recorded', async () => {
    show({ ...PROFILE, licence_number: '1234567', licence_grade: 'C' });
    await screen.findByText('Musa Bello');
    expect(screen.getByText('GRADE')).toBeTruthy();
    expect(screen.getByText('C')).toBeTruthy();
  });
});
