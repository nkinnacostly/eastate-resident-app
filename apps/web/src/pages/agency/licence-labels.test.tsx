import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agency, ReturnRow, RosterRow } from '../../lib/agency';
import { AgencyMonthlyReturn } from './monthly-return';
import { AgencyOfficers } from './officers';

afterEach(cleanup);

// The product is built for Nigerian estates. PSIRA is South Africa's guard
// regulator, so its name, grades and filing rules must reach only an agency
// that registered with it -- a Nigerian agency sees plain licence wording.

const auth = vi.hoisted(() => ({ agencies: [] as Agency[] }));
vi.mock('../../lib/auth-context', () => ({ useAuth: () => auth }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const data = vi.hoisted(() => ({
  listRoster: vi.fn(async (): Promise<RosterRow[]> => []),
  monthlyReturn: vi.fn(async (): Promise<ReturnRow[]> => []),
}));
vi.mock('../../lib/agency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/agency')>()),
  ...data,
}));
const csv = vi.hoisted(() => ({ downloadCsv: vi.fn() }));
vi.mock('../../lib/csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/csv')>()),
  ...csv,
}));

const agency = (registration_body: string | null): Agency => ({
  agency_id: 'ag-1',
  name: 'Gatekeepers Ltd',
  registration_number: 'RC-1',
  registration_body,
  registration_expires_at: null,
  registration_checked_at: null,
  role: 'admin',
});

const OFFICER: RosterRow = {
  agency_membership_id: 'am-1',
  full_name: 'Musa Bello',
  role: 'officer',
  is_active: true,
  registration_number: null,
  grade: null,
  registration_expires_at: null,
  registration_checked_at: null,
  estates_posted: 1,
};

const RETURN_ROW: ReturnRow = {
  officer_name: 'Musa Bello',
  registration_number: 'LIC-77',
  grade: null,
  contact_phone: null,
  registration_expires_at: null,
  registration_checked_at: null,
  estate_name: 'Palm Court',
  estate_address: null,
  first_shift_at: '2026-10-02T07:00:00Z',
  last_shift_at: '2026-10-28T19:00:00Z',
  shifts: 20,
  hours: 240,
};

beforeEach(() => {
  vi.clearAllMocks();
  data.listRoster.mockResolvedValue([OFFICER]);
  data.monthlyReturn.mockResolvedValue([RETURN_ROW]);
});

const show = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe.each([
  ['an NSCDC-registered agency', 'NSCDC'],
  ['an agency with no registration body recorded', null],
])('for %s', (_, body) => {
  beforeEach(() => {
    auth.agencies = [agency(body)];
  });

  it('the officers page never says PSIRA, and has no grade column', async () => {
    const { container } = show(<AgencyOfficers />);
    await screen.findByText('Musa Bello');
    expect(screen.getByText('LICENCE NUMBER')).toBeTruthy();
    expect(screen.queryByText('GRADE')).toBeNull();
    expect(container.textContent).not.toMatch(/PSIRA/);
    expect(container.querySelector('a[href*="psira"]')).toBeNull();
  });

  it('the monthly return and its CSV never say PSIRA', async () => {
    const { container } = show(<AgencyMonthlyReturn />);
    await screen.findByText('Palm Court');
    expect(screen.getByText('LICENCE NUMBER')).toBeTruthy();
    expect(screen.getByText('MISSING LICENCE NUMBER')).toBeTruthy();
    expect(container.textContent).not.toMatch(/PSIRA|South Africa/);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Export CSV' }));
    const [filename, body] = csv.downloadCsv.mock.calls[0] as [string, string];
    expect(filename).toMatch(/^officer-return-\d{4}-\d{2}\.csv$/);
    const header = body.replace(/^﻿/, '').split(/\r?\n/)[0];
    expect(header).toContain('Licence number');
    expect(header).not.toMatch(/PSIRA|Grade/);
  });
});

describe('for a PSIRA-registered agency', () => {
  beforeEach(() => {
    auth.agencies = [agency('PSIRA')];
  });

  it('the officers page keeps PSIRA wording, the grade column and the verification link', async () => {
    const { container } = show(<AgencyOfficers />);
    await screen.findByText('Musa Bello');
    expect(screen.getByText('PSIRA NUMBER')).toBeTruthy();
    expect(screen.getByText('GRADE')).toBeTruthy();
    expect(container.querySelector('a[href*="psira.co.za"]')).toBeTruthy();
  });

  it('the monthly return is still the PSIRA return', async () => {
    show(<AgencyMonthlyReturn />);
    await screen.findByText('Palm Court');
    expect(screen.getByText('MISSING PSIRA NUMBER')).toBeTruthy();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Export CSV' }));
    const [filename, body] = csv.downloadCsv.mock.calls[0] as [string, string];
    expect(filename).toMatch(/^psira-return-/);
    expect(body).toContain('PSIRA number');
    expect(body).toContain('Grade');
  });
});
