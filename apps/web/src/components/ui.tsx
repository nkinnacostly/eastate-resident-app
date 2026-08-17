import type { ReactNode } from 'react';

import { SearchIcon } from './icons';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card border border-line bg-card ${className}`}>{children}</div>;
}

export function Chip({
  children,
  tone = 'plain',
  className = '',
}: {
  children: ReactNode;
  tone?: 'plain' | 'on' | 'good' | 'bad';
  className?: string;
}) {
  const tones = {
    plain: 'bg-field text-muted',
    on: 'bg-ink text-canvas',
    good: 'bg-lime-soft text-lime-ink',
    bad: 'bg-coral-soft text-coral-ink',
  } as const;
  return (
    <span
      className={`inline-flex h-[26px] items-center rounded-chip px-3 text-[11px] font-bold ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'lime',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'lime' | 'quiet' | 'dark';
  className?: string;
}) {
  const v = {
    lime: 'bg-lime text-ink hover:brightness-95',
    quiet: 'bg-field text-muted hover:bg-hair',
    dark: 'bg-ink text-canvas hover:brightness-125',
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center rounded-chip px-4 text-[12.5px] font-extrabold transition disabled:opacity-50 ${v} ${className}`}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[11px] font-bold tracking-label text-muted">{label}</div>
      <div className={`mt-2.5 text-[26px] font-extrabold leading-none ${tone === 'bad' ? 'text-coral-ink' : ''}`}>
        {value}
      </div>
    </Card>
  );
}

export function PageHead({
  title,
  blurb,
  right,
}: {
  title: ReactNode;
  blurb?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-5">
      <div className="min-w-0">
        <h1 className="text-[27px] font-extrabold tracking-tight">{title}</h1>
        {blurb ? <p className="mt-1.5 max-w-[64ch] text-[13px] leading-[19px] text-muted">{blurb}</p> : null}
      </div>
      {right ? <div className="flex flex-none items-center gap-2.5">{right}</div> : null}
    </div>
  );
}

/** The estate pill + primary action that sits at the top right of every page. */
export function HeadActions({ estate, children }: { estate: string; children?: ReactNode }) {
  return (
    <>
      <span className="inline-flex h-[42px] items-center rounded-chip bg-field px-4 text-[12px] font-bold text-muted">
        {estate}
      </span>
      {children}
    </>
  );
}

export function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex h-11 flex-1 items-center gap-2.5 rounded-[14px] bg-field px-4 text-muted">
      <SearchIcon />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-muted"
      />
    </div>
  );
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`h-11 rounded-chip px-4 text-[12px] font-bold transition ${
            o === value ? 'bg-ink text-canvas' : 'bg-field text-muted hover:brightness-95'
          }`}
        >
          {o}
        </button>
      ))}
    </>
  );
}

/** Row count on the left, page controls on the right. */
export function TableFoot({ showing, total }: { showing: number; total: number }) {
  return (
    <div className="mt-4 flex items-center justify-between text-[12px] font-semibold text-muted">
      <span>
        Showing {showing} of {total}
      </span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-[13px] text-muted">{children}</div>;
}

/** Monospaced-feel code, letter-spaced so it can be read aloud at a gate. */
export function Code({ children }: { children: ReactNode }) {
  return <span className="font-extrabold tracking-code">{children}</span>;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ name, className = '' }: { name: string; className?: string }) {
  return (
    <div
      className={`flex h-8 w-8 flex-none items-center justify-center rounded-[11px] bg-field text-[11px] font-extrabold text-muted ${className}`}
    >
      {initials(name)}
    </div>
  );
}
