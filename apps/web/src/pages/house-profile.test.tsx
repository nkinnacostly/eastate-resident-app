import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HouseDetail, HouseResident } from '../lib/detail';
import { HouseProfile } from './house-profile';

afterEach(cleanup);

// The data layer is mocked at the module boundary: these modules import the
// Supabase client, which refuses to load without credentials. What the RPC
// actually returns is pinned separately by test:detail-contract.
vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({ activeEstateId: 'est-1', activeEstate: { estate_name: 'Demo Estate' } }),
}));
vi.mock('../lib/api', () => ({ listEstateDuesPayments: vi.fn(async () => []) }));

const resident = (over: Partial<HouseResident>): HouseResident => ({
  membership_id: 'm0',
  full_name: 'Unnamed',
  phone: null,
  email: null,
  last_sign_in_at: null,
  is_active: true,
  joined_at: '2026-01-15T10:00:00Z',
  live_codes: 0,
  codes_30d: 0,
  in_arrears: false,
  ...over,
});

const detail: HouseDetail = {
  house: {
    house_id: 'h1', house_number: '12', house_code: 'AB12', is_active: true,
    created_at: '2026-01-01T00:00:00Z', landlord_name: 'Lola Landlord', landlord_phone: null,
    landlord_email: null, dues_payer: 'residents', dues_amount_minor: 500000, currency: 'NGN',
    grace_days: 7, dues_payer_override: 'residents', dues_amount_override: 500000,
  },
  residents: [
    resident({ membership_id: 'm1', full_name: 'Ada Okafor', email: 'ada@example.com',
               phone: '+2348000000001', last_sign_in_at: '2026-10-01T09:00:00Z', live_codes: 2 }),
    resident({ membership_id: 'm2', full_name: 'Bo Bello', email: 'bo@example.com', in_arrears: true }),
    resident({ membership_id: 'm3', full_name: 'Cy Chukwu', is_active: false }),
  ],
  charges: [],
  stats: { codes_30d: 4, visitors_admitted_30d: 1 },
};

vi.mock('../lib/detail', () => ({ getHouseDetail: vi.fn(async () => detail) }));

function Probe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/houses/:houseId" element={<><HouseProfile /><Probe /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

const table = () => screen.findByRole('table', { name: 'Residents of this house' });
const rowNamed = async (name: string) =>
  within(await table()).getByRole('row', { name: new RegExp(name) });

describe('House page: residents table', () => {
  it('lists every resident with the columns an admin needs', async () => {
    renderAt('/houses/h1');
    const ada = await rowNamed('Ada Okafor');
    expect(within(ada).getByText('ada@example.com')).toBeTruthy();
    expect(within(ada).getByText('+2348000000001')).toBeTruthy();
    expect(within(ada).getByText('Up to date')).toBeTruthy();

    expect(within(await rowNamed('Bo Bello')).getByText('Overdue')).toBeTruthy();
    expect(within(await rowNamed('Bo Bello')).getByText('Never')).toBeTruthy();
    expect(within(await rowNamed('Cy Chukwu')).getByText('Suspended')).toBeTruthy();
  });

  it("links each name to that resident's profile", async () => {
    renderAt('/houses/h1');
    const link = within(await rowNamed('Ada Okafor')).getByRole('link', { name: /Ada Okafor/ });
    expect(link.getAttribute('href')).toBe('/residents/m1');
  });

  it('opens already filtered when the link carries a search', async () => {
    renderAt('/houses/h1?q=bello');
    const rows = within(await table()).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Bo Bello');
  });

  it('searches by email, and writes the search to the URL', async () => {
    const user = userEvent.setup();
    renderAt('/houses/h1');
    await user.type(await screen.findByPlaceholderText('Search residents by name, phone or email'), 'ada@');
    expect(screen.getByTestId('search').textContent).toBe('?q=ada%40');
    const rows = within(await table()).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Ada Okafor')]);
  });

  // TanStack sorts a non-text column DESCENDING on the first click
  // (column_getAutoSortDir), which for Dues means overdue first -- the order an
  // admin opening this column is looking for.
  it('puts overdue residents first on one click of the Dues header', async () => {
    const user = userEvent.setup();
    renderAt('/houses/h1');
    await user.click(within(await table()).getByRole('button', { name: /dues/i }));
    expect(screen.getByTestId('search').textContent).toBe('?sort=-in_arrears');
    const first = within(await table()).getAllByRole('row')[1];
    expect(first.textContent).toContain('Bo Bello');
  });
});
