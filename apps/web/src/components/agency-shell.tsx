import { NavLink, Outlet } from 'react-router-dom';
import type { NavLinkRenderProps } from 'react-router-dom';

import { useAuth } from '../lib/auth-context';
import { initials } from '../lib/format';
import { Brand, EstatesIcon, GridIcon, GuardsIcon } from './icons';

/**
 * The security agency's shell.
 *
 * Three destinations, and the shortness is the design. There is no roster
 * editor, no shift planner, no patrol tour and no invoicing, because the moment
 * this grows those it stops being a window onto a guarding contract and becomes
 * workforce software competing with vendors who have sold it for fifteen years.
 * The agency is a distribution channel here, not a paying tenant: South African
 * estates increasingly buy security technology THROUGH the guarding contract,
 * and the one comparable product found gives agencies their dashboard free in
 * exchange for estate referrals. A free, read-mostly portal is the whole play.
 *
 * Amber rather than the operator's lime, and it says AGENCY under the mark, for
 * a reason that is not decoration: the same person can be an estate admin and
 * an agency admin, and "which hat am I wearing" decides what they are allowed
 * to see. Two dashboards that look identical are two dashboards someone will
 * confuse.
 */
const NAV = [
  { to: '/agency', label: 'Coverage', Icon: GridIcon, end: true },
  { to: '/agency/officers', label: 'Officers', Icon: GuardsIcon },
  { to: '/agency/return', label: 'Monthly return', Icon: EstatesIcon },
];

export function AgencyShell() {
  const { session, signOut, estates, isPlatformAdmin, agencies } = useAuth();
  const name = (session?.user.user_metadata?.full_name as string | undefined) ?? 'Agency';
  const agencyName = agencies[0]?.name ?? 'Security agency';

  return (
    <div className="flex h-screen bg-ink p-4">
      <aside className="flex w-[236px] flex-none flex-col px-3 pb-3 pt-3.5">
        <div className="flex items-center gap-2.5 px-2 pb-6">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-canvas">
            <Brand />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-extrabold tracking-tight text-canvas">
              {agencyName}
            </div>
            <div className="mt-0.5 text-[10px] font-bold tracking-[0.1em] text-amber-400">
              AGENCY
            </div>
          </div>
        </div>

        <nav className="flex flex-col">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }: NavLinkRenderProps) =>
                `flex h-[42px] items-center gap-3 rounded-[14px] px-3.5 text-[13.5px] font-semibold transition ${
                  isActive ? 'bg-ink-2 text-canvas' : 'text-muted-2 hover:text-canvas'
                }`
              }
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="flex-1" />

        {/* Only when they genuinely hold the other role. A link to a dashboard
            you cannot enter is a dead end. */}
        {estates.length > 0 ? (
          <a
            href="/estate"
            className="mb-2.5 flex h-[38px] items-center justify-center rounded-chip bg-ink-3 text-[12px] font-bold text-canvas transition hover:brightness-125"
          >
            Estate dashboard →
          </a>
        ) : null}
        {isPlatformAdmin ? (
          <a
            href="/operator"
            className="mb-2.5 flex h-[38px] items-center justify-center rounded-chip bg-ink-3 text-[12px] font-bold text-canvas transition hover:brightness-125"
          >
            Operator dashboard →
          </a>
        ) : null}

        <div className="flex items-center gap-3 rounded-[22px] bg-ink-2 p-[18px]">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[14px] bg-canvas text-[13px] font-extrabold text-ink">
            {initials(name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-extrabold text-canvas">{name}</div>
            <div className="mt-0.5 whitespace-nowrap text-[11px] font-semibold text-muted-2">
              Agency admin
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            title="Sign out"
            aria-label="Sign out"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-ink-3 text-muted-2 transition hover:text-canvas"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 17v1.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2V7" />
              <path d="M10 12h10m0 0-3-3m3 3-3 3" />
            </svg>
          </button>
        </div>
      </aside>

      <main className="ml-4 min-h-0 min-w-0 flex-1 overflow-y-auto rounded-pane bg-canvas px-[30px] py-7">
        <Outlet />
      </main>
    </div>
  );
}
