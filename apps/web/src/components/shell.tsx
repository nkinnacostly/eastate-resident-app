import { NavLink, Outlet, useLocation } from 'react-router-dom';
import type { NavLinkRenderProps } from 'react-router-dom';

import { useAuth } from '../lib/auth';
import {
  Brand,
  Chevron,
  CodesIcon,
  GuardsIcon,
  HomeIcon,
  LogIcon,
  SettingsIcon,
} from './icons';
import { initials } from './ui';

/**
 * Nav mirrors the design: Overview owns a group of sub-destinations, the rest
 * are flat. The chevron only appears on items that actually expand — a
 * disclosure arrow on a leaf promises something that never happens.
 */
// Bare segments, turned into absolute paths against `base` below.
//
// Not react-router relative links: those resolve against the CURRENT location,
// not the mount, so at /estate/houses a `to="houses"` link resolves to
// /estate/houses/houses and every nav item compounds a level deeper on each
// click. An explicit base is the only version that stays correct at both
// mounts.
const NAV = [
  {
    to: '',
    label: 'Overview',
    Icon: HomeIcon,
    children: [
      { to: '', label: 'Today at the gate', end: true },
      { to: 'houses', label: 'Houses' },
      { to: 'residents', label: 'Residents' },
      { to: 'flagged', label: 'Flagged entries' },
    ],
  },
  { to: 'guards', label: 'Guards', Icon: GuardsIcon },
  { to: 'codes', label: 'Codes', Icon: CodesIcon },
  { to: 'audit', label: 'Audit log', Icon: LogIcon },
  { to: 'settings', label: 'Settings', Icon: SettingsIcon },
];

const GROUP_PATHS = ['', 'houses', 'residents', 'flagged'];

/**
 * @param base Where this shell is mounted: '' at the root for an estate admin,
 *   '/estate' for a platform owner who also administers one.
 */
export function Shell({ base = '' }: { base?: string }) {
  const { session, estates, activeEstate, setActiveEstateId, signOut } = useAuth();
  const { pathname } = useLocation();
  const name = (session?.user.user_metadata?.full_name as string | undefined) ?? 'Admin';
  const here = pathname.slice(base.length).replace(/^\//, '');
  const inGroup = GROUP_PATHS.includes(here);
  const href = (seg: string) => `${base}/${seg}`.replace(/\/$/, '') || '/';

  return (
    <div className="flex h-screen bg-ink p-4">
      <aside className="flex w-[236px] flex-none flex-col px-3 pb-3 pt-3.5">
        <div className="flex items-center gap-2.5 px-2 pb-6">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-lime">
            <Brand />
          </div>
          <div className="text-[15px] font-extrabold tracking-tight text-canvas">myestateaccess</div>
        </div>

        <nav className="flex flex-col">
          {NAV.map(({ to, label, Icon, children }) => {
            const active = children ? inGroup : here === to;
            return (
              <div key={label}>
                <NavLink
                  to={href(to)}
                  end={!children}
                  className={`flex h-[42px] items-center gap-3 rounded-[14px] px-3.5 text-[13.5px] font-semibold transition ${
                    active ? 'bg-ink-2 text-canvas' : 'text-muted-2 hover:text-canvas'
                  }`}
                >
                  <Icon />
                  {label}
                  {children ? <Chevron up={active} className="ml-auto" /> : null}
                </NavLink>

                {children && active ? (
                  <div className="my-1.5 flex flex-col">
                    {children.map((c) => (
                      <NavLink
                        key={c.to}
                        to={href(c.to)}
                        end={c.end}
                        className={({ isActive }: NavLinkRenderProps) =>
                          `flex h-[30px] items-center gap-2.5 pl-11 text-[12.5px] font-medium transition ${
                            isActive ? 'text-lime' : 'text-muted-2 hover:text-canvas'
                          }`
                        }
                      >
                        <span className="h-px w-2.5 bg-current" />
                        {c.label}
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="rounded-[22px] bg-ink-2 p-5 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-lime text-[19px] font-extrabold text-ink">
            {initials(name)}
          </div>
          <div className="text-[13.5px] font-extrabold text-canvas">{name}</div>
          <div className="mt-1 text-[11.5px] font-semibold text-muted-2">
            Estate admin · {activeEstate?.estate_name ?? 'No estate'}
          </div>

          {/* Rendered only when there is somewhere to switch TO — a control that
              cannot do anything is worse than no control. */}
          {estates.length > 1 ? (
            <select
              value={activeEstate?.estate_id ?? ''}
              onChange={(e) => setActiveEstateId(e.target.value)}
              className="mt-3.5 h-[38px] w-full rounded-chip bg-ink-3 px-3 text-center text-[12.5px] font-bold text-canvas"
            >
              {estates.map((e) => (
                <option key={e.estate_id} value={e.estate_id}>
                  {e.estate_name}
                </option>
              ))}
            </select>
          ) : null}

          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-2.5 h-[38px] w-full rounded-chip bg-ink-3 text-[12.5px] font-bold text-canvas transition hover:brightness-125"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* min-h-0 lets the pane scroll internally instead of pushing the shell
          past the viewport, which is what left the old layout floating. */}
      <main className="ml-4 min-h-0 min-w-0 flex-1 overflow-y-auto rounded-pane bg-canvas px-8 py-7">
        <Outlet />
      </main>
    </div>
  );
}
