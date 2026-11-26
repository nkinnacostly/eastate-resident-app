import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Estates } from './estates';

afterEach(cleanup);

// Onboarding no longer offers dues. A new estate has no payout account, and
// set_dues_config refuses to bill without one, so a billing model chosen here
// was silently dropped and the operator was told the estate was set up.
const operator = vi.hoisted(() => ({
  listOperatorEstates: vi.fn(async () => []),
  onboardEstate: vi.fn(async () => ({
    estate_id: 'e-1', estate_name: 'Silver Oaks', join_code: 'ABCD2345',
    admin_email: 'admin@example.com', admin_user_id: 'u-1', password: 'AAAA-BBBB-CCCC-DDDD',
    reused_existing_account: false,
  })),
}));
vi.mock('../../lib/operator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/operator')>()),
  ...operator,
}));

beforeEach(() => vi.clearAllMocks());

describe('onboarding an estate', () => {
  it('asks for no dues, sends none, and says where dues are set', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <Estates />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Onboard an estate' }));
    expect(screen.queryByText(/ESTATE DUES/)).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.textContent).toMatch(/Dues are set later by the\s+estate on its Dues page/);

    await user.type(screen.getByPlaceholderText('Sable Ridge'), 'Silver Oaks');
    await user.type(screen.getByPlaceholderText('admin@estate.example'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Create estate and admin' }));

    expect(operator.onboardEstate).toHaveBeenCalledOnce();
    const sent = (operator.onboardEstate.mock.calls as unknown as [Record<string, unknown>][])[0][0];
    expect(sent).toMatchObject({ estate_name: 'Silver Oaks', admin_email: 'admin@example.com' });
    expect(Object.keys(sent).filter((k) => k.startsWith('dues'))).toEqual([]);
  });
});
