import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettlementCard } from './settlement-card';

afterEach(cleanup);

// Payout accounts are Nigerian only (20261030160000). Every one is checked
// with the bank before it can be saved; there is no country to pick and no
// "type the name yourself" path for an account the bank cannot confirm.

const api = vi.hoisted(() => ({
  getEstateSettlement: vi.fn(async () => ({ settlement: null, testMode: false })),
  listSettlementBanks: vi.fn(async () => [{ code: '044', name: 'Access Bank' }]),
  resolveSettlementAccount: vi.fn(),
  saveEstateSettlement: vi.fn(async () => ({ account_name: 'PALM COURT RA', verified: true })),
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

describe('adding the estate’s payout account', () => {
  it('offers no country, and never mentions South Africa', async () => {
    const { container } = await startAdding();
    expect(screen.queryByText('Country')).toBeNull();
    expect(container.textContent).not.toMatch(/South Africa/);
    expect(api.listSettlementBanks).toHaveBeenCalledWith();
  });

  it('saves only after the bank has named the account, and sends no country', async () => {
    api.resolveSettlementAccount.mockResolvedValueOnce({ account_name: 'PALM COURT RA', verified: true });
    const { user } = await startAdding();
    await user.selectOptions(screen.getAllByRole('combobox')[0], '044');
    await user.type(screen.getByPlaceholderText('0690000032'), '0690000032');

    const save = screen.getByRole('button', { name: 'Save this account' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Check account' }));
    await screen.findByText('PALM COURT RA');
    expect(api.resolveSettlementAccount).toHaveBeenCalledWith('est-1', '044', '0690000032');
    expect((save as HTMLButtonElement).disabled).toBe(false);

    await user.click(save);
    expect(api.saveEstateSettlement).toHaveBeenCalledWith({
      estateId: 'est-1',
      bankCode: '044',
      bankName: 'Access Bank',
      accountNumber: '0690000032',
    });
  });

  it('a lookup the bank rejects leaves Save disabled, with no name to type instead', async () => {
    api.resolveSettlementAccount.mockRejectedValueOnce(new Error('That account number is not valid at the bank you chose.'));
    const { user } = await startAdding();
    await user.selectOptions(screen.getAllByRole('combobox')[0], '044');
    await user.type(screen.getByPlaceholderText('0690000032'), '1234567890');
    await user.click(screen.getByRole('button', { name: 'Check account' }));

    await screen.findByText(/not valid at the bank/);
    expect((screen.getByRole('button', { name: 'Save this account' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByPlaceholderText(/as the bank has it/)).toBeNull();
  });
});
