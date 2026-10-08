import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardGuardResult } from '../lib/api';
import { Guards } from './guards';

afterEach(cleanup);

// Data layer mocked at the module boundary (these modules import the Supabase
// client, which will not load without credentials).
vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({ activeEstateId: 'est-1', activeEstate: { estate_name: 'Demo Estate' } }),
}));
const api = vi.hoisted(() => ({
  listPeople: vi.fn(async () => []),
  currentShift: vi.fn(async () => null),
  onboardGuard: vi.fn(),
}));
vi.mock('../lib/api', () => api);

// The three shapes onboard-guard answers with.
const NEW_ACCOUNT: OnboardGuardResult = {
  estate_id: 'est-1',
  email: 'thabo@example.com',
  full_name: 'Thabo Nkosi',
  password: 'kX7-mQ2-vR9',
  invited: false,
  guard_user_id: 'user-9',
  reused_existing_account: false,
  welcome_email_queued: true,
};
const INVITED: OnboardGuardResult = {
  estate_id: 'est-1',
  email: 'naledi@example.com',
  // Only what the admin typed: nothing about an existing account comes back.
  full_name: 'Naledi',
  password: null,
  invited: true,
  guard_user_id: null,
  reused_existing_account: true,
  welcome_email_queued: true,
};
const ALREADY_A_GUARD: OnboardGuardResult = {
  ...INVITED,
  invited: false,
  welcome_email_queued: false,
};

beforeEach(() => vi.clearAllMocks());

async function register(result: OnboardGuardResult) {
  api.onboardGuard.mockResolvedValueOnce(result);
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Guards />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'Register a guard' }));
  await user.type(screen.getByPlaceholderText('thabo@example.com'), result.email);
  await user.click(screen.getByRole('button', { name: 'Register guard' }));
  await screen.findByRole('button', { name: 'Done' });
  expect(api.onboardGuard).toHaveBeenCalledWith(
    expect.objectContaining({ estate_id: 'est-1', email: result.email }),
  );
}

// The report this exists for: typing an existing account's email made that
// person a guard here without asking them. It now sends an invitation, and the
// panel must say so -- not "can now work the gate", which is no longer true
// until they accept.
describe('registering an address that already has an account', () => {
  it('says an invitation was sent, and how they accept it', async () => {
    await register(INVITED);

    expect(screen.getByText('Invitation sent to naledi@example.com')).toBeTruthy();
    const blurb = screen.getByText(/already have a myestateaccess account/).textContent;
    expect(blurb).toMatch(/accept the invitation in the guard app, signed in with their own password/);
    expect(blurb).toMatch(/appear in your guards list once they accept/);
    expect(screen.queryByText(/can now work the gate/)).toBeNull();
  });

  it('shows no password box -- there is nothing to hand over', async () => {
    await register(INVITED);

    expect(screen.queryByText('PASSWORD')).toBeNull();
    expect(screen.queryByText(/Hand these to the guard/)).toBeNull();
  });

  // The invitation exists either way -- it waits in the guard app -- but
  // "sent" would have the admin waiting on an email that is not coming.
  it('does not claim an email went out when it could not be queued', async () => {
    await register({ ...INVITED, welcome_email_queued: false });

    expect(screen.queryByText(/Invitation sent/)).toBeNull();
    expect(screen.getByText('Invitation created for naledi@example.com')).toBeTruthy();
    expect(screen.getByText(/could not email them the invitation/)).toBeTruthy();
  });
});

describe('registering a new account', () => {
  it('hands over the generated password, as before', async () => {
    await register(NEW_ACCOUNT);

    expect(screen.getByText('Thabo Nkosi can now work the gate')).toBeTruthy();
    expect(screen.getByText('PASSWORD')).toBeTruthy();
    expect(screen.getByText('kX7-mQ2-vR9')).toBeTruthy();
    expect(screen.getByText(/emailed them a link to set their own password/)).toBeTruthy();
    expect(screen.queryByText(/Invitation/)).toBeNull();
  });
});

describe('registering somebody who is already a guard here', () => {
  it('says nothing changed, with no password and no invitation', async () => {
    await register(ALREADY_A_GUARD);

    expect(screen.getByText('naledi@example.com is already a guard here')).toBeTruthy();
    expect(screen.queryByText('PASSWORD')).toBeNull();
    expect(screen.queryByText(/Invitation/)).toBeNull();
    expect(screen.queryByText(/can now work the gate/)).toBeNull();
  });
});
