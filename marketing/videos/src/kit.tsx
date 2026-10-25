/**
 * Shared motion kit for the 5 W's videos.
 *
 * Brand tokens are the product's own (apps/web/tailwind.config.js) and the
 * typeface is the apps' Plus Jakarta Sans, so the videos look like the thing
 * they advertise. Every video renders at 9:16 for Reels and TikTok and at 4:5
 * for feed posts, 30fps: the five W's run 90 seconds each, the intro 60.
 */
import { loadFont } from '@remotion/fonts';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export const FONT = 'Plus Jakarta Sans';
for (const [file, weight] of [
  ['Regular', '400'],
  ['Medium', '500'],
  ['SemiBold', '600'],
  ['Bold', '700'],
  ['ExtraBold', '800'],
] as const) {
  loadFont({ family: FONT, url: staticFile(`PlusJakartaSans-${file}.ttf`), weight });
}

export const C = {
  ink: '#16181c',
  ink2: '#23262b',
  ink3: '#31353b',
  canvas: '#f7f9fb',
  field: '#eef1f5',
  line: '#e3e7ec',
  muted: '#656c74',
  muted2: '#8d9299',
  lime: '#cdf24a',
  limeSoft: '#eaf3d6',
  limeInk: '#3f4a22',
  coral: '#ff6b57',
  coralSoft: '#ffe2dc',
  coralInk: '#a33c2b',
  white: '#ffffff',
};

/** 9:16 is the main format (Reels and TikTok); 4:5 is kept for feed posts. */
export const FORMATS = {
  '9x16': { width: 1080, height: 1920 },
  '4x5': { width: 1080, height: 1350 },
} as const;
export const FPS = 30;
export const TOTAL = 90 * FPS;
export const INTRO_TOTAL = 60 * FPS;

/**
 * Where content may sit in this format. At 9:16 it keeps clear of the
 * Reels/TikTok overlays: the top ~250px, the caption and buttons along the
 * bottom ~350px, and the action column on the right (safe-zone guides
 * checked Oct 2026; the platforms publish no single official figure).
 */
export function useFormat() {
  const { width, height } = useVideoConfig();
  const vertical = height / width > 1.5;
  const inset = vertical ? { top: 280, right: 120, bottom: 380, left: 80 } : { top: 170, right: 72, bottom: 90, left: 72 };
  return { vertical, inset, contentW: width - inset.left - inset.right };
}

// ─── Motion ──────────────────────────────────────────────────────────────────

/** 0 -> 1 spring that starts at `delay` frames into the current sequence. */
export function useIn(delay = 0, damping = 18, mass = 0.8): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass, stiffness: 120 } });
}

/** Linear 0 -> 1 between two frames, clamped and eased. */
export function useProgress(from: number, to: number, ease = Easing.inOut(Easing.cubic)): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
}

export const rise = (p: number, dist = 40): CSSProperties => ({
  opacity: Math.min(1, p * 1.4),
  transform: `translateY(${(1 - p) * dist}px)`,
});

export const pop = (p: number): CSSProperties => ({
  opacity: Math.min(1, p * 1.6),
  transform: `scale(${0.6 + 0.4 * p})`,
});

// ─── Stage ───────────────────────────────────────────────────────────────────

/** Dark brand stage with two slow lime glows and a faint grid. */
export function Stage({ children, light = false }: { children: ReactNode; light?: boolean }) {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const bg = light ? C.canvas : C.ink;
  const glow = light ? 'rgba(205,242,74,0.35)' : 'rgba(205,242,74,0.16)';
  const gx = 50 + Math.sin(t * 0.35) * 18;
  const gy = 28 + Math.cos(t * 0.28) * 10;
  return (
    <AbsoluteFill style={{ backgroundColor: bg, fontFamily: FONT, color: light ? C.ink : C.white, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${gx}% ${gy}%, ${glow} 0%, transparent 42%), radial-gradient(circle at ${100 - gx}% ${90 - gy / 2}%, ${glow} 0%, transparent 38%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: light ? 0.5 : 0.35,
          backgroundImage: `linear-gradient(${light ? '#e3e7ec' : '#23262b'} 1px, transparent 1px), linear-gradient(90deg, ${light ? '#e3e7ec' : '#23262b'} 1px, transparent 1px)`,
          backgroundSize: '90px 90px',
          maskImage: 'radial-gradient(circle at 50% 45%, black 20%, transparent 75%)',
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

/** A slow push-in, so a held scene never looks frozen. */
export function Drift({ children, amount = 0.035 }: { children: ReactNode; amount?: number }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const s = interpolate(frame, [0, Math.max(1, durationInFrames)], [1 + amount, 1], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ transform: `scale(${s})` }}>{children}</AbsoluteFill>;
}

// ─── Brand ───────────────────────────────────────────────────────────────────

export function KeyGlyph({ size = 24, color = C.ink, width = 2.1 }: { size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round">
      <circle cx="9" cy="12" r="4" />
      <path d="M13 12h8M17.6 12v3.2M20.2 12v2.4" />
    </svg>
  );
}

export function Logo({ size = 54, light = false, word = true }: { size?: number; light?: boolean; word?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3 }}>
      <div style={{ width: size, height: size, borderRadius: size * 0.28, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <KeyGlyph size={size * 0.68} />
      </div>
      {word ? (
        <span style={{ fontWeight: 800, fontSize: size * 0.5, letterSpacing: '-0.02em', color: light ? C.ink : C.white }}>myestateaccess</span>
      ) : null}
    </div>
  );
}

export const SERIES = ['Who', 'What', 'Why', 'Where', 'When'] as const;
export type Series = (typeof SERIES)[number];

/** Persistent header: logo, and the five W's with this video's one lit (the intro has none). */
export function Header({ current, delay = 0 }: { current?: Series; delay?: number }) {
  const p = useIn(delay + 4, 22);
  const { vertical, inset } = useFormat();
  // At 9:16 the top of the frame sits under the app's own header, so drop down.
  const pos = vertical ? { top: 186, left: inset.left, right: inset.right } : { top: 54, left: 60, right: 60 };
  return (
    <div style={{ position: 'absolute', ...pos, display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...rise(p, -20) }}>
      <Logo size={50} />
      <div style={{ display: 'flex', gap: 8 }}>
        {current && SERIES.map((s) => (
          <div
            key={s}
            style={{
              padding: '9px 15px',
              borderRadius: 999,
              fontSize: 19,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: s === current ? C.lime : 'rgba(255,255,255,0.08)',
              color: s === current ? C.ink : C.muted2,
            }}
          >
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Thin progress bar along the bottom edge, over the whole video. */
export function Progress() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div style={{ position: 'absolute', left: 0, bottom: 0, height: 8, width: `${(frame / durationInFrames) * 100}%`, background: C.lime }} />
  );
}

// ─── Type ────────────────────────────────────────────────────────────────────

/** Words spring up one after another. */
export function Title({
  text,
  size = 88,
  delay = 0,
  color,
  stagger = 4,
  align = 'left',
  weight = 800,
  highlight = [],
  style,
}: {
  text: string;
  size?: number;
  delay?: number;
  color?: string;
  stagger?: number;
  align?: 'left' | 'center';
  weight?: number;
  /** Words (exactly as written) to paint lime. */
  highlight?: string[];
  style?: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(' ');
  return (
    <div
      style={{
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1.06,
        letterSpacing: '-0.035em',
        wordSpacing: '0.06em',
        textAlign: align,
        // Balanced lines: a headline never ends on one stranded word, whatever
        // width the format gives it.
        textWrap: 'balance',
        ...style,
      }}
    >
      {words.map((w, i) => {
        const p = spring({ frame: frame - delay - i * stagger, fps, config: { damping: 16, mass: 0.7, stiffness: 140 } });
        return (
          <Fragment key={i}>
            {i > 0 ? ' ' : null}
            <span style={{ display: 'inline-block', verticalAlign: 'top', overflow: 'hidden', paddingBottom: size * 0.08 }}>
              <span
                style={{
                  display: 'inline-block',
                  transform: `translateY(${(1 - p) * 105}%)`,
                  opacity: Math.min(1, p * 2),
                  color: highlight.includes(w) ? C.lime : color,
                }}
              >
                {/* Trailing punctuation tucked in: at display sizes the font's
                    side-bearing leaves a gap that reads as "seconds ." */}
                {/[.,?!]$/.test(w) ? (
                  <>
                    {w.slice(0, -1)}
                    <span style={{ marginLeft: '-0.06em' }}>{w.slice(-1)}</span>
                  </>
                ) : (
                  w
                )}
              </span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

export function Kicker({ children, delay = 0, color = C.lime }: { children: ReactNode; delay?: number; color?: string }) {
  const p = useIn(delay);
  return (
    <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color, ...rise(p, 20) }}>
      {children}
    </div>
  );
}

export function Body({ children, delay = 0, size = 38, color, style }: { children: ReactNode; delay?: number; size?: number; color?: string; style?: CSSProperties }) {
  const p = useIn(delay, 20);
  return (
    <div style={{ fontSize: size, lineHeight: 1.38, fontWeight: 500, color: color ?? 'rgba(255,255,255,0.78)', textWrap: 'pretty', ...rise(p, 26), ...style }}>
      {children}
    </div>
  );
}

/** Lime pill used for short facts. */
export function Pill({ children, delay = 0, tone = 'lime', size = 30 }: { children: ReactNode; delay?: number; tone?: 'lime' | 'dark' | 'coral' | 'light'; size?: number }) {
  const p = useIn(delay, 14);
  const tones = {
    lime: { background: C.lime, color: C.ink },
    dark: { background: C.ink3, color: C.white },
    coral: { background: C.coralSoft, color: C.coralInk },
    light: { background: C.white, color: C.ink },
  }[tone];
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: `${size * 0.42}px ${size * 0.8}px`, borderRadius: 999, fontWeight: 800, fontSize: size, ...tones, ...pop(p) }}>
      {children}
    </div>
  );
}

/** Content area between the header and the bottom edge. */
export function Frame({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { inset } = useFormat();
  return (
    <div style={{ position: 'absolute', ...inset, display: 'flex', flexDirection: 'column', ...style }}>
      {children}
    </div>
  );
}

/** Small note at the bottom of a scene ("Illustration. Names are examples."). */
export function Note({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const p = useIn(delay);
  const { vertical, inset } = useFormat();
  return (
    <div style={{ position: 'absolute', left: inset.left, right: inset.right, bottom: vertical ? inset.bottom - 50 : 34, fontSize: 18, color: C.muted2, opacity: p * 0.9 }}>{children}</div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

const ICONS: Record<string, ReactNode> = {
  key: (<><circle cx="9" cy="12" r="4" /><path d="M13 12h8M17.6 12v3.2M20.2 12v2.4" /></>),
  shield: (<><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /><path d="M8.5 12.2l2.4 2.4 4.6-4.8" /></>),
  wifiOff: (<><path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0" /><circle cx="12" cy="19" r="1" /><path d="M3 3l18 18" /></>),
  house: (<><path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" /></>),
  people: (<><circle cx="9" cy="8.4" r="3.2" /><path d="M3.4 19.4c.6-3 3-4.7 5.6-4.7s5 1.7 5.6 4.7M16.4 6.2a3.2 3.2 0 0 1 0 6M18 14.9c2 .5 3.4 2.1 3.8 4.5" /></>),
  money: (<><rect x="3" y="6.5" width="18" height="11" rx="2.4" /><circle cx="12" cy="12" r="2.6" /></>),
  calendar: (<><rect x="3.5" y="5" width="17" height="15.5" rx="2.4" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  bell: (<><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>),
  link: (<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>),
  gate: (<><path d="M4 20V5M20 20V5M4 8h16M8 8v12M12 8v12M16 8v12" /></>),
  phone: (<><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>),
  list: (<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>),
  chart: (<><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>),
  flag: (<><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>),
  clock: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  globe: (<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17" /></>),
  store: (<><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></>),
  lock: (<><rect x="5" y="10.5" width="14" height="10" rx="2.4" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>),
  x: (<><path d="M6 6l12 12M18 6L6 18" /></>),
  check: (<><path d="M5 12.5l4.5 4.5L19 7.5" /></>),
  msg: (<><path d="M4 5h16v11H9l-5 4z" /></>),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>),
  building: (<><rect x="5" y="3.5" width="14" height="17" rx="1.5" /><path d="M9 7.5h2M13 7.5h2M9 11.5h2M13 11.5h2M10.5 20.5v-4h3v4" /></>),
  box: (<><path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" /><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9" /></>),
};

export function Icon({ name, size = 40, color = C.ink, width = 1.9 }: { name: keyof typeof ICONS | string; size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

/** Rounded lime tile holding an icon. */
export function IconTile({ name, size = 84, bg = C.lime, fg = C.ink, delay = 0 }: { name: string; size?: number; bg?: string; fg?: string; delay?: number }) {
  const p = useIn(delay, 13);
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.3, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...pop(p) }}>
      <Icon name={name} size={size * 0.52} color={fg} />
    </div>
  );
}

/** A card that rises into place. */
export function Card({ children, delay = 0, style, dark = false }: { children: ReactNode; delay?: number; style?: CSSProperties; dark?: boolean }) {
  const p = useIn(delay, 17);
  return (
    <div
      style={{
        background: dark ? C.ink2 : C.white,
        color: dark ? C.white : C.ink,
        borderRadius: 34,
        padding: 34,
        boxShadow: dark ? 'none' : '0 30px 60px rgba(0,0,0,0.22)',
        ...rise(p, 50),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
