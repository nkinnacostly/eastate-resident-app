import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../lib/auth-context';

/** The same floor as the other password screens on this dashboard. */
const MIN_PASSWORD = 8;
/** Supabase's own ceiling: bcrypt reads at most 72 bytes. */
const MAX_PASSWORD = 72;

const field =
  'h-12 w-full rounded-[14px] bg-field px-4 text-[14px] outline-none focus:ring-2 focus:ring-lime';

/**
 * "Forgot password" for everyone who signs in here: estate admins, landlords,
 * agency admins and the platform owner.
 *
 * Code-first, like the resident app: the email carries a short code to type
 * here rather than a link, so it works whichever device the email is opened
 * on. Welcome emails for admins and guards point here when their
 * set-password link has expired -- until this page existed, that advice led
 * nowhere and a locked-out admin had no way back in.
 */
export function ResetPassword() {
  const { requestPasswordReset, completePasswordReset } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setError('Enter the email address you sign in with.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await requestPasswordReset(address);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setEmail(address);
    setStep('code');
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = code.trim();
    if (!/^\d{6,10}$/.test(digits)) {
      setError('The code is the row of digits in the email we sent you.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password.length > MAX_PASSWORD) {
      setError(`A password is at most ${MAX_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await completePasswordReset(email, digits, password);
    setBusy(false);
    // On success the session is released and the app moves on by itself.
    if (result.status === 'bad_code') {
      setError('That code is wrong or has expired. Send a new one and try again.');
    } else if (result.status === 'error') {
      setError(result.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <form
        onSubmit={step === 'email' ? sendCode : reset}
        className="w-full max-w-[380px] rounded-pane bg-canvas p-8"
        noValidate
      >
        <h1 className="text-[27px] font-extrabold tracking-tight">Reset your password</h1>

        {step === 'email' ? (
          <>
            <p className="mt-1.5 text-[13px] text-muted">
              Enter the email you sign in with and we will send you a code to choose a new password.
            </p>
            <div className="mt-6">
              <input
                type="email"
                autoComplete="email"
                aria-label="Email"
                placeholder="you@estate.co.za"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={field}
              />
            </div>
          </>
        ) : (
          <>
            {/* Worded so it reveals nothing: the function answers the same
                whether or not the address has an account. */}
            <p className="mt-1.5 text-[13px] text-muted">
              If <strong className="text-ink">{email}</strong> has an account, a code is on its way.
              It expires in 60 minutes.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Code from the email"
                placeholder="Code from the email"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${field} tracking-code`}
              />
              <input
                type="password"
                autoComplete="new-password"
                aria-label="New password"
                placeholder={`New password (at least ${MIN_PASSWORD} characters)`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
              <input
                type="password"
                autoComplete="new-password"
                aria-label="Confirm new password"
                placeholder="Type it again"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={field}
              />
            </div>
          </>
        )}

        {error ? (
          <div
            role="alert"
            className="mt-3 rounded-[12px] bg-coral-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-coral-ink"
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 h-12 w-full rounded-chip bg-lime text-[14px] font-extrabold text-ink disabled:opacity-50"
        >
          {step === 'email'
            ? busy ? 'Sending…' : 'Send code'
            : busy ? 'Saving…' : 'Set new password'}
        </button>

        <div className="mt-4 flex justify-between text-[12.5px] font-bold text-muted">
          <Link to="/" className="hover:text-ink">
            Back to sign in
          </Link>
          {step === 'code' ? (
            <button
              type="button"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
              className="hover:text-ink"
            >
              Send a new code
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
