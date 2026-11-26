import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  deactivateMembership: vi.fn(async () => undefined),
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

// One neutral licence number, whichever country's regulator issued it (the
// NSCDC in Nigeria, PSIRA in South Africa), and no grade (20261030160000).
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

describe('removing a guard from the gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks first, then deactivates the membership and shows them removed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.getGuardProfile
      .mockResolvedValueOnce({ ...PROFILE, on_duty_since: '2026-11-26T06:00:00Z' })
      .mockResolvedValueOnce({ ...PROFILE, is_active: false, on_duty_since: null });
    render(
      <MemoryRouter initialEntries={['/guards/m-1']}>
        <Routes>
          <Route path="/guards/:membershipId" element={<GuardProfile />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Remove from the gate' }));

    // The warning names the guard and the estate, and says what happens to the phone.
    expect(confirm).toHaveBeenCalledOnce();
    const message = confirm.mock.calls[0][0] as string;
    expect(message).toContain('Remove Musa Bello from Palm Court?');
    expect(message).toMatch(/phone clears its codes/);
    expect(message).toMatch(/stay on record/);

    expect(api.deactivateMembership).toHaveBeenCalledWith('m-1');
    await screen.findByText('Removed');
    expect(screen.queryByText(/On duty/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove from the gate' })).toBeNull();
  });

  it('does nothing when the admin cancels', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    show(PROFILE);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Remove from the gate' }));
    expect(api.deactivateMembership).not.toHaveBeenCalled();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows the server refusal instead of pretending it worked', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.deactivateMembership.mockRejectedValueOnce(new Error('not_an_admin_at_this_estate'));
    show(PROFILE);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Remove from the gate' }));
    await screen.findByText('not_an_admin_at_this_estate');
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('offers no removal for a guard who is already removed', async () => {
    show({ ...PROFILE, is_active: false });
    await screen.findByText('Removed');
    expect(screen.queryByRole('button', { name: 'Remove from the gate' })).toBeNull();
  });
});
