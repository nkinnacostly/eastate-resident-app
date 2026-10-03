import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HouseDetail } from '../lib/detail';
import { HouseProfile } from './house-profile';
import { Houses } from './houses';

afterEach(cleanup);

// Data layer mocked at the module boundary (these modules import the Supabase
// client, which will not load without credentials).
vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({ activeEstateId: 'est-1', activeEstate: { estate_name: 'Demo Estate' } }),
}));
vi.mock('../lib/api', () => ({
  listHouses: vi.fn(async () => [
    {
      id: 'house-2', house_code: 'VHM7', house_number: '2', landlord_name: 'Madam Esther',
      landlord_phone: null, landlord_email: null, is_active: true, residents: 1,
      dues_payer: null, dues_amount_minor: null,
    },
  ]),
  getDuesConfig: vi.fn(async () => null),
  createHouse: vi.fn(),
  rotateHouseCode: vi.fn(),
  remindHouseDues: vi.fn(),
  importHouses: vi.fn(),
  listEstateDuesPayments: vi.fn(async () => []),
}));

const detail: HouseDetail = {
  house: {
    house_id: 'house-2', house_number: '2', house_code: 'VHM7', is_active: true,
    created_at: '2026-01-01T00:00:00Z', landlord_name: 'Madam Esther', landlord_phone: null,
    landlord_email: null, dues_payer: 'landlord', dues_amount_minor: 2500000, currency: 'NGN',
    grace_days: 7, dues_payer_override: null, dues_amount_override: null,
  },
  residents: [],
  charges: [],
  stats: { codes_30d: 0, visitors_admitted_30d: 0 },
};
vi.mock('../lib/detail', () => ({ getHouseDetail: vi.fn(async () => detail) }));

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/houses']}>
      <Routes>
        <Route path="/houses" element={<Houses />} />
        <Route path="/houses/:houseId" element={<HouseProfile />} />
      </Routes>
    </MemoryRouter>,
  );
}

// The report this exists for: an admin on the Houses list could not find a way
// into a house. The number was the only link, and a lone digit does not read
// as something to press.
describe('Houses list -> house page', () => {
  it('gives every house an obvious View button', async () => {
    renderApp();
    const view = await screen.findByRole('link', { name: 'View house 2' });
    expect(view.textContent).toBe('View');
    expect(view.getAttribute('href')).toBe('/houses/house-2');
  });

  it('opens the house page from View', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole('link', { name: 'View house 2' }));
    expect(await screen.findByRole('heading', { name: 'House 2' })).toBeTruthy();
    expect(screen.getByText('Madam Esther')).toBeTruthy();
  });

  it('opens it from the house number too', async () => {
    const user = userEvent.setup();
    renderApp();
    const row = (await screen.findByText('VHM7')).parentElement as HTMLElement;
    await user.click(within(row).getByRole('link', { name: '2' }));
    expect(await screen.findByRole('heading', { name: 'House 2' })).toBeTruthy();
  });
});
