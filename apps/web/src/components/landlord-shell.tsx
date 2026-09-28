import { Outlet } from 'react-router-dom';

import { useAuth } from '../lib/auth-context';
import { Brand } from './icons';

/**
 * The landlord's chrome.
 *
 * NO SIDEBAR AND NO NAV, deliberately. The estate and agency shells carry one
 * because they have five or six destinations; a landlord has exactly one — the
 * properties they own and what is owed on them. A navigation rail with a
 * single highlighted item is furniture pretending to be structure, and it
 * makes a small, honest product look like a stripped-down version of a bigger
 * one.
 *
 * Teal rather than the estate's lime or the agency's amber, and it says
 * LANDLORD under the mark, for the reason the other shells are coloured: the
 * same person can be an estate admin AND own property in someone else's
 * estate, and "which hat am I wearing" decides what they are allowed to see.
 * Two dashboards that look alike are two dashboards somebody will confuse.
 */
export function LandlordShell() {
  const { session, signOut, estates, isPlatformAdmin } = useAuth();
  const name = (session?.user.user_metadata?.full_name as string | undefined) ?? 'Landlord';

  return (
    <div className="min-h-screen bg-ink">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-canvas">
            <Brand />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-extrabold tracking-tight text-canvas">
              {name}
            </div>
            <div className="mt-0.5 text-[10px] font-bold tracking-[0.1em] text-teal-300">
              LANDLORD
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Only for someone who genuinely holds the other role. A link to a
              dashboard you cannot enter is a dead end, which is the rule the
              other shells follow too. */}
          {estates.length > 0 || isPlatformAdmin ? (
            <a
              href="/"
              className="text-[12.5px] font-bold text-canvas/70 transition hover:text-canvas"
            >
              Estate dashboard
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-9 rounded-chip bg-canvas/10 px-4 text-[12.5px] font-extrabold text-canvas transition hover:bg-canvas/20"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] rounded-pane bg-canvas px-7 pb-10 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
