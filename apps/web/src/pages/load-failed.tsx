import { useState } from 'react';

import { useAuth } from '../lib/auth-context';

/**
 * Shown when the estate lookup fails and will not recover on its own.
 *
 * This screen exists because of a real outage. A foreign key added for an
 * audit column made PostgREST unable to resolve `estates(name)` — two possible
 * relationships, so it refused with 300 PGRST201 — and the lookup began
 * failing permanently. The provider deliberately does not mark itself loaded
 * on failure, which is right for a network blip and disastrous for a permanent
 * error: the gate renders a blank dark screen while it waits, so every admin,
 * resident and guard was met with an empty black page and no way forward.
 *
 * A dead end with no control on it is the worst possible failure. Something
 * that names the problem, offers a retry and offers a way out is recoverable
 * even when we have got it wrong.
 */
export function LoadFailed({ detail }: { detail: string }) {
  const { session, signOut, refreshEstates } = useAuth();
  const [retrying, setRetrying] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className="w-full max-w-[440px] rounded-pane bg-canvas p-8">
        <h1 className="text-[24px] font-extrabold tracking-tight">We could not load your estate</h1>
        <p className="mt-2 text-[13.5px] leading-[21px] text-muted">
          You are signed in as <strong className="text-ink">{session?.user.email}</strong>. Your
          account is fine — something went wrong fetching the estates you administer.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              void refreshEstates().finally(() => setRetrying(false));
            }}
            className="h-11 rounded-chip bg-lime px-5 text-[13px] font-extrabold text-ink disabled:opacity-50"
          >
            {retrying ? 'Trying again…' : 'Try again'}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-11 rounded-chip bg-field px-5 text-[13px] font-extrabold text-muted"
          >
            Sign out
          </button>
        </div>

        {/* The raw message, on purpose. It is what turns "it is broken" into a
            report somebody can act on, and it is the caller's own error — it
            reveals nothing they could not already see in the network tab. */}
        <p className="mt-5 break-words text-[11.5px] leading-[17px] text-muted">{detail}</p>
      </div>
    </div>
  );
}
