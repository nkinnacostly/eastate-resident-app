import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResetPassword } from './reset-password';
import { SignIn } from './sign-in';

afterEach(cleanup);

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  requestPasswordReset: vi.fn(async () => ({ error: null as string | null })),
  completePasswordReset: vi.fn(async () => ({ status: 'ok' as const })),
}));
vi.mock('../lib/auth-context', () => ({ useAuth: () => auth }));

beforeEach(() => vi.clearAllMocks());

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<SignIn />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function toCodeStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), '  admin@estate.co.za ');
  await user.click(screen.getByRole('button', { name: 'Send code' }));
}

describe('Forgot password', () => {
  it('is reachable from the sign-in page', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByRole('link', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeTruthy();
  });

  it('refuses something that is not an email address, without calling out', async () => {
    const user = userEvent.setup();
    renderAt('/reset-password');
    await user.type(screen.getByLabelText('Email'), 'admin');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByRole('alert').textContent).toMatch(/email address/);
    expect(auth.requestPasswordReset).not.toHaveBeenCalled();
  });

  // Enumeration: the screen must read the same for an address with no account.
  it('sends the code, then says only that one is on its way IF the account exists', async () => {
    const user = userEvent.setup();
    renderAt('/reset-password');
    await toCodeStep(user);
    expect(auth.requestPasswordReset).toHaveBeenCalledWith('admin@estate.co.za');
    expect(screen.getByText(/has an account, a code is on its way/)).toBeTruthy();
  });

  it('checks the code shape and that the passwords match before trying', async () => {
    const user = userEvent.setup();
    renderAt('/reset-password');
    await toCodeStep(user);

    await user.type(screen.getByLabelText('Code from the email'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(screen.getByRole('alert').textContent).toMatch(/row of digits/);

    await user.clear(screen.getByLabelText('Code from the email'));
    await user.type(screen.getByLabelText('Code from the email'), '123456');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(screen.getByRole('alert').textContent).toMatch(/at least 8/);

    await user.clear(screen.getByLabelText('New password'));
    await user.type(screen.getByLabelText('New password'), 'long-enough-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'long-enough-2');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(screen.getByRole('alert').textContent).toMatch(/do not match/);
    expect(auth.completePasswordReset).not.toHaveBeenCalled();
  });

  it('resets with the address, code and password', async () => {
    const user = userEvent.setup();
    renderAt('/reset-password');
    await toCodeStep(user);
    await user.type(screen.getByLabelText('Code from the email'), '123456');
    await user.type(screen.getByLabelText('New password'), 'long-enough-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(auth.completePasswordReset).toHaveBeenCalledWith('admin@estate.co.za', '123456', 'long-enough-1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains a wrong or expired code and offers a fresh one', async () => {
    const user = userEvent.setup();
    auth.completePasswordReset.mockResolvedValueOnce({ status: 'bad_code' } as never);
    renderAt('/reset-password');
    await toCodeStep(user);
    await user.type(screen.getByLabelText('Code from the email'), '999999');
    await user.type(screen.getByLabelText('New password'), 'long-enough-1');
    await user.type(screen.getByLabelText('Confirm new password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(screen.getByRole('alert').textContent).toMatch(/wrong or has expired/);

    await user.click(screen.getByRole('button', { name: 'Send a new code' }));
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy();
  });
});
