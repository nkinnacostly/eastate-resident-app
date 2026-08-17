import { useState } from 'react';

import { useAuth } from '../lib/auth';

export function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await signIn(email.trim(), password);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-[380px] rounded-pane bg-canvas p-8"
      >
        <h1 className="text-[27px] font-extrabold tracking-tight">Estate Access</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Sign in with your estate admin account.
        </p>

        <div className="mt-6 flex flex-col gap-2.5">
          <input
            type="email"
            autoComplete="email"
            placeholder="you@estate.co.za"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-[14px] bg-field px-4 text-[14px] outline-none focus:ring-2 focus:ring-lime"
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-[14px] bg-field px-4 text-[14px] outline-none focus:ring-2 focus:ring-lime"
          />
        </div>

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
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
