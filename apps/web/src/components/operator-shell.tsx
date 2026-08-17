import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../lib/auth';
import { Brand, EstatesIcon, GridIcon, GuardsIcon, HealthIcon, SettingsIcon } from './icons';
import { initials } from './ui';

/**
 * The operator's own shell.
 *
 * Flat nav, no expanding group — unlike the estate dashboard, where Overview
 * owns a set of sub-destinations. The design draws them differently because
 * they ARE different: an operator moves between whole subjects, an estate admin
 * drills into one estate.
 *
 * Billing is deliberately absent. The design has a Billing screen, but nothing
 * in this platform models a subscription, invoice or payment, and a nav item
 * leading to invented figures is worse than one that is not there.
 */
const NAV = [
  { to: '/', label: 'Portfolio', Icon: GridIcon, end: true },
  { to: '/estates', label: 'Estates', Icon: EstatesIcon },
  { to: '/admins', label: 'Admins', Icon: GuardsIcon },
  { to: '/health', label: 'Platform health', Icon: HealthIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

export function OperatorShell() {
  const { session, signOut, estates } = useAuth();
  const name = (session?.user.user_metadata?.full_name as string | undefined) ?? 'Operator';

  return (
    <div className="flex h-screen bg-ink p-4">
      <aside className="flex w-[236px] flex-none flex-col px-3 pb-3 pt-3.5">
        <div className="flex items-center gap-2.5 px-2 pb-6">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-canvas">
            <Brand />
          </div>
          <div>
            <div className="text-[14px] font-extrabold tracking-tight text-canvas">Estate Access</div>
            <div className="mt-0.5 text-[10px] font-bold tracking-[0.1em] text-lime">OPERATOR</div>
          </div>
        </div>

        <nav className="flex flex-col">
          {NAV.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
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

        {/* Only rendered when this person actually administers an estate too.
            A link to a dashboard they cannot enter is a dead end. */}
        {estates.length > 0 ? (
          <a
            href="/estate"
            className="mb-2.5 flex h-[38px] items-center justify-center rounded-chip bg-ink-3 text-[12px] font-bold text-canvas transition hover:brightness-125"
          >
            Estate dashboard →
          </a>
        ) : null}

        <div className="flex items-center gap-3 rounded-[22px] bg-ink-2 p-[18px]">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-[14px] bg-canvas text-[13px] font-extrabold text-ink">
            {initials(name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-extrabold text-canvas">{name}</div>
            <div className="mt-0.5 whitespace-nowrap text-[11px] font-semibold text-muted-2">
              Platform owner
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
