import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dues } from './dues';

afterEach(cleanup);

// A South African estate's first dues setup. The form used to start at NGN
// whatever the payout account was, and saving it failed with a raw
// currency_does_not_match_settlement_account.
vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({ activeEstateId: 'est-1', activeEstate: { estate_name: 'Silver Oaks' } }),
}));
const payout = (country: 'NG' | 'ZA') => ({
  settlement: {
    country, bank_code: 'FNB', bank_name: 'First National Bank', account_mask: '•••• 4587',
    account_name: 'Silver Oaks HOA', account_verified: false, configured_at: '2026-11-26T08:00:00Z',
    fee_percent: 0, billing_mode: 'none' as const,
  },
  testMode: false,
});
const api = vi.hoisted(() => ({
  getDuesConfig: vi.fn(async () => ({
    dues_billing_mode: 'none', dues_amount_minor: null, dues_currency: null, dues_grace_days: 7,
    dues_enforcement_authorised_at: null, dues_enforcement_basis: null,
  })),
  listDuesCharges: vi.fn(async () => []),
  getEstateSettlement: vi.fn(),
  listSettlementBanks: vi.fn(async () => []),
  setDuesConfig: vi.fn(),
  raiseCurrentDues: vi.fn(),
  remindDuesCharge: vi.fn(),
  setDuesEnforcement: vi.fn(),
  waiveDuesCharge: vi.fn(),
  resolveSettlementAccount: vi.fn(),
  saveEstateSettlement: vi.fn(),
  clearEstateSettlement: vi.fn(),
}));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  ...api,
}));

beforeEach(() => vi.clearAllMocks());

async function chooseBilling() {
  render(
    <MemoryRouter>
      <Dues />
    </MemoryRouter>,
  );
  const billedTo = await screen.findByDisplayValue('Not collecting dues');
  await userEvent.setup().selectOptions(billedTo, 'per_house');
}

describe('the currency a new dues setup starts in', () => {
  it('is rand when the payout account is South African', async () => {
    api.getEstateSettlement.mockResolvedValue(payout('ZA'));
    await chooseBilling();
    expect(await screen.findByDisplayValue('ZAR')).toBeTruthy();
    expect(screen.queryByDisplayValue('NGN')).toBeNull();
  });

  it('is naira when the payout account is Nigerian', async () => {
    api.getEstateSettlement.mockResolvedValue(payout('NG'));
    await chooseBilling();
    expect(await screen.findByDisplayValue('NGN')).toBeTruthy();
  });

  it('still loads, at NGN, when the payout account cannot be read', async () => {
    api.getEstateSettlement.mockRejectedValue(new Error('offline'));
    await chooseBilling();
    expect(await screen.findByDisplayValue('NGN')).toBeTruthy();
  });
});
