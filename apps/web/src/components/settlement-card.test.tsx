import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettlementCard } from './settlement-card';

afterEach(cleanup);

// Payout accounts are Nigerian or South African. A Nigerian bank confirms the
// account holder's name, so a Nigerian account saves only with that name. South
// African banks have no name lookup on the rail: the check comes back
// unverified rather than failed, and the admin types the name exactly as the
// bank has it before saving.

const api = vi.hoisted(() => ({
  getEstateSettlement: vi.fn(async () => ({ settlement: null, testMode: false })),
  listSettlementBanks: vi.fn(async (country: 'NG' | 'ZA') =>
    country === 'NG' ? [{ code: '044', name: 'Access Bank' }] : [{ code: 'FNB', name: 'First National Bank' }],
  ),
  resolveSettlementAccount: vi.fn(),
  saveEstateSettlement: vi.fn(async () => ({ account_name: 'SAVED', verified: true })),
  clearEstateSettlement: vi.fn(),
}));
vi.mock('../lib/api', () => api);

beforeEach(() => vi.clearAllMocks());

async function startAdding() {
  const user = userEvent.setup();
  const { container } = render(<SettlementCard estateId="est-1" />);
  await user.click(await screen.findByRole('button', { name: /Add the estate.s account/ }));
  await screen.findByRole('option', { name: 'Access Bank' });
  return { user, container };
}

const save = () => screen.getByRole('button', { name: 'Save this account' }) as HTMLButtonElement;

describe('a Nigerian payout account', () => {
  it('saves only after the bank has named it', async () => {
    api.resolveSettlementAccount.mockResolvedValueOnce({ account_name: 'PALM COURT RA', verified: true });
    const { user } = await startAdding();
    expect(api.listSettlementBanks).toHaveBeenCalledWith('NG');
    await user.selectOptions(screen.getByDisplayValue('Choose a bank'), '044');
    await user.type(screen.getByPlaceholderText('0690000032'), '0690000032');
    expect(save().disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Check account' }));
    await screen.findByText('PALM COURT RA');
    expect(api.resolveSettlementAccount).toHaveBeenCalledWith('est-1', 'NG', '044', '0690000032');
    expect(screen.queryByPlaceholderText(/as the bank has it/)).toBeNull();
    expect(save().disabled).toBe(false);

    await user.click(save());
    expect(api.saveEstateSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ estateId: 'est-1', country: 'NG', bankCode: '044', accountNumber: '0690000032', accountName: 'PALM COURT RA' }),
    );
  });

  it('a lookup the bank rejects leaves Save disabled, with no name to type instead', async () => {
    api.resolveSettlementAccount.mockRejectedValueOnce(new Error('That account number is not valid at the bank you chose.'));
    const { user } = await startAdding();
    await user.selectOptions(screen.getByDisplayValue('Choose a bank'), '044');
    await user.type(screen.getByPlaceholderText('0690000032'), '1234567890');
    await user.click(screen.getByRole('button', { name: 'Check account' }));

    await screen.findByText(/not valid at the bank/);
    expect(save().disabled).toBe(true);
    expect(screen.queryByPlaceholderText(/as the bank has it/)).toBeNull();
  });
});

describe('a South African payout account', () => {
  it('lists South African banks, and saves with the name the admin types', async () => {
    api.resolveSettlementAccount.mockResolvedValueOnce({ account_name: null, verified: false, unverifiable: true });
    const { user, container } = await startAdding();
    await user.selectOptions(screen.getByDisplayValue('Nigeria'), 'ZA');
    await screen.findByRole('option', { name: 'First National Bank' });
    expect(api.listSettlementBanks).toHaveBeenLastCalledWith('ZA');

    await user.selectOptions(screen.getByDisplayValue('Choose a bank'), 'FNB');
    await user.type(screen.getByPlaceholderText('0690000032'), '62152854587');
    await user.click(screen.getByRole('button', { name: 'Check account' }));
    expect(api.resolveSettlementAccount).toHaveBeenCalledWith('est-1', 'ZA', 'FNB', '62152854587');

    // Unverified is not failed: the card says the bank cannot confirm it and asks for the name.
    const name = await screen.findByPlaceholderText(/as the bank has it/);
    expect(container.textContent).toMatch(/no account-name check for South African accounts/);
    expect(save().disabled).toBe(true);

    await user.type(name, 'Silver Oaks HOA');
    expect(save().disabled).toBe(false);
    await user.click(save());
    expect(api.saveEstateSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'ZA', bankCode: 'FNB', accountNumber: '62152854587', accountName: 'Silver Oaks HOA' }),
    );
  });
});
