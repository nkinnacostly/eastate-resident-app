/**
 * Sidebar icon set, transcribed from the design: 19px, 1.8 stroke, round caps,
 * no fill, `currentColor` so a nav item can flip between muted and canvas
 * without the icon needing to know.
 */
type P = { className?: string };

const S = ({ children, className = '' }: P & { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    className={`h-[19px] w-[19px] flex-none fill-none stroke-current ${className}`}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

export const HomeIcon = (p: P) => (
  <S {...p}>
    <path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
  </S>
);

export const GuardsIcon = (p: P) => (
  <S {...p}>
    <circle cx="9" cy="8.4" r="3.2" />
    <path d="M3.4 19.4c.6-3 3-4.7 5.6-4.7s5 1.7 5.6 4.7M16.4 6.2a3.2 3.2 0 0 1 0 6M18 14.9c2 .5 3.4 2.1 3.8 4.5" />
  </S>
);

export const CodesIcon = (p: P) => (
  <S {...p}>
    <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.8" />
    <path d="M7 9.4h.01M11 9.4h.01M15 9.4h.01M7 14.6h10" strokeWidth={2.1} />
  </S>
);

export const LogIcon = (p: P) => (
  <S {...p}>
    <path d="M5.4 4.4h13.2v15.2H5.4z" />
    <path d="M8.4 9h7.2M8.4 12.4h7.2M8.4 15.8h4.2" />
  </S>
);

export const SettingsIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="7.6" />
    <circle cx="12" cy="12" r="2.6" />
  </S>
);

export const Chevron = ({ up = false, className = '' }: P & { up?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className={`h-[15px] w-[15px] flex-none fill-none stroke-current ${className}`}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={up ? 'm6 14 6-6 6 6' : 'm6 10 6 6 6-6'} />
  </svg>
);

export const SearchIcon = ({ className = '' }: P) => (
  <svg
    viewBox="0 0 24 24"
    className={`h-[17px] w-[17px] flex-none fill-none stroke-current ${className}`}
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="6.4" />
    <path d="m16 16 4 4" />
  </svg>
);

// ─── operator dashboard ──────────────────────────────────────────────────────
// Transcribed from the operator design's own SVG paths, so the two dashboards
// share a drawing style rather than one being redrawn by hand.

export const GridIcon = (p: P) => (
  <S {...p}>
    <rect x="3.6" y="3.6" width="7" height="7" rx="1.8" />
    <rect x="13.4" y="3.6" width="7" height="7" rx="1.8" />
    <rect x="3.6" y="13.4" width="7" height="7" rx="1.8" />
    <rect x="13.4" y="13.4" width="7" height="7" rx="1.8" />
  </S>
);

export const EstatesIcon = (p: P) => (
  <S {...p}>
    <path d="M4 20V7l8-3 8 3v13" />
    <path d="M9 20v-6h6v6" />
  </S>
);

export const HealthIcon = (p: P) => (
  <S {...p}>
    <path d="M3.4 13h4l2.2-5.4 3 9.6 2.4-6.2 1.6 2h4" />
  </S>
);

/** The lime app mark: a key, echoing the code a resident hands out. */
export const Brand = () => (
  <svg viewBox="0 0 24 24" className="h-[17px] w-[17px] fill-none stroke-ink" strokeWidth={2.1} strokeLinecap="round">
    <circle cx="9" cy="12" r="4" />
    <path d="M13 12h8M17.6 12v3.2M20.2 12v2.4" />
  </svg>
);
