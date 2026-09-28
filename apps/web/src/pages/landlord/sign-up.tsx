import { useState } from 'react';

import { supabase } from '../../lib/supabase';

/**
 * The only self-service sign-up on this dashboard, and the only one that can
 * safely exist here.
 *
 * Every other account is created by invitation: estate admins by the platform
 * owner, guards by their estate. A landlord has nobody to invite them —
 * they are recorded on a house as an email address and have never needed a
 * login at all. Without this page the portal they were given is unreachable.
 *
 * ─── Why open sign-up leaks nothing ─────────────────────────────────────────
 *
 * Creating an account grants NOTHING on its own. A landlord sees houses only
 * where their CONFIRMED email matches the address an estate recorded, so a
 * stranger who signs up sees an empty dashboard and a sentence telling them to
 * ask the estate office. The account is a way to hold a session; the estate's
 * own record is the authority, and it always was.
 *
 * That is also why the wording below promises nothing. "Use the address your
 * estate has for you" is the whole instruction, and getting it wrong produces
 * an empty dashboard rather than a confusing error.
 */
export function LandlordSignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Choose a password of at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink p-4">
        <div className="w-full max-w-[420px] rounded-pane bg-canvas p-8">
          <h1 className="text-[24px] font-extrabold tracking-tight">Check your email</h1>
          <p className="mt-2 text-[13.5px] leading-[21px] text-muted">
            We have sent a confirmation link to{' '}
            <strong className="text-ink">{email.trim()}</strong>. Open it to finish setting up
            your account.
          </p>
          {/* Said plainly, because it is the one thing that decides whether the
              dashboard has anything in it. Confirming is not a formality here:
              an unconfirmed address matches no house at all. */}
          <p className="mt-3 text-[12.5px] leading-[19px] text-muted">
            Your properties appear once that address is confirmed and it matches what your estate
            has on record for you.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex h-11 items-center rounded-chip bg-field px-5 text-[13px] font-extrabold text-muted"
          >
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <form onSubmit={submit} className="w-full max-w-[420px] rounded-pane bg-canvas p-8">
        <h1 className="text-[24px] font-extrabold tracking-tight">Landlord account</h1>
        <p className="mt-2 text-[13.5px] leading-[21px] text-muted">
          See every property you own across estates, what is owed on each, and pay without
          waiting for an email.
        </p>

        <div className="mt-6 flex flex-col gap-2.5">
          <input
            autoComplete="name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-12 rounded-[14px] bg-field px-4 text-[14px] outline-none focus:ring-2 focus:ring-lime"
          />
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Email your estate has for you"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-[14px] bg-field px-4 text-[14px] outline-none focus:ring-2 focus:ring-lime"
          />
          <input
            type="password"
            required
            autoComplete="new-password"
            placeholder="Choose a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-[14px] bg-field px-4 text-[14px] outline-none focus:ring-2 focus:ring-lime"
          />
        </div>

        <p className="mt-3 text-[12px] leading-[18px] text-muted">
          Use the address your estate has on file for you — that is how we know which houses are
          yours. If it does not match, your dashboard will be empty and the estate office can
          correct it.
        </p>

        {error ? (
          <div className="mt-3 rounded-[12px] bg-coral-soft px-3.5 py-2.5 text-[12.5px] font-semibold text-coral-ink">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 h-12 w-full rounded-chip bg-lime text-[14px] font-extrabold text-ink disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <a
          href="/"
          className="mt-4 block text-center text-[12.5px] font-bold text-muted hover:text-ink"
        >
          Already have an account? Sign in
        </a>
      </form>
    </div>
  );
}
