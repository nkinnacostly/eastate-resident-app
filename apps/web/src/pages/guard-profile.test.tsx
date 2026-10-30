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

// The estates are Nigerian: the licence is a licence number, never a "PSIRA
// number", and there is no grade to show (20261030160000).
describe("an estate admin's guard profile", () => {
  it('labels the licence plainly, with no grade', async () => {
    const { container } = show({ ...PROFILE, licence_number: 'NSCDC/PGC/0042' });
    await screen.findByText('Musa Bello');
    expect(screen.getByText('LICENCE NUMBER')).toBeTruthy();
    expect(screen.getByText('NSCDC/PGC/0042')).toBeTruthy();
    expect(screen.queryByText('GRADE')).toBeNull();
    expect(container.textContent).not.toMatch(/PSIRA/);
  });
});
