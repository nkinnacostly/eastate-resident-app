/**
 * Layouts for the trustees' walkthrough film (16:9, 1920x1080).
 *
 * The film is captions and visuals with music, no voice: every scene carries
 * one headline a trustee can read in two seconds and at most two short lines
 * under it, and the visual does the explaining.
 */
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

import { Body, C, IconTile, Kicker, Title, rise, useIn } from '../kit';

export const W = 1920;
export const H = 1080;
export const PAD = { top: 150, left: 96, right: 96, bottom: 96 };

/** Dark scene background, so transitions never flash. */
export function Scene({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <AbsoluteFill style={{ backgroundColor: light ? C.canvas : C.ink }}>{children}</AbsoluteFill>;
}

/** Copy on the left, the visual on the right. */
export function Split({
  kicker, title, body, visual, highlight = [], copyW = 640, size = 64, bullets,
}: {
  kicker?: string; title: string; body?: ReactNode; visual: ReactNode; highlight?: string[];
  copyW?: number; size?: number; bullets?: string[];
}) {
  return (
    <Scene>
      <div style={{ position: 'absolute', ...PAD, display: 'flex', alignItems: 'center', gap: 72 }}>
        <div style={{ width: copyW, flexShrink: 0 }}>
          {kicker ? <Kicker delay={2}>{kicker}</Kicker> : null}
          <Title text={title} size={size} delay={6} highlight={highlight} style={{ marginTop: kicker ? 18 : 0 }} />
          {body ? <Body delay={22} size={31} style={{ marginTop: 26 }}>{body}</Body> : null}
          {bullets ? <Bullets items={bullets} delay={30} /> : null}
        </div>
        <div style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          {visual}
        </div>
      </div>
    </Scene>
  );
}

/** Lime-dot bullets that arrive one after another. */
export function Bullets({ items, delay = 0, step = 14, size = 28, light = false }: { items: string[]; delay?: number; step?: number; size?: number; light?: boolean }) {
  return (
    <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {items.map((t, i) => (
        <Bullet key={i} delay={delay + i * step} size={size} light={light}>{t}</Bullet>
      ))}
    </div>
  );
}

function Bullet({ children, delay, size, light }: { children: ReactNode; delay: number; size: number; light: boolean }) {
  const p = useIn(delay, 18);
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', fontSize: size, lineHeight: 1.36, fontWeight: 500, color: light ? C.ink : 'rgba(255,255,255,0.84)', ...rise(p, 18) }}>
      <div style={{ width: 12, height: 12, borderRadius: 6, background: C.lime, marginTop: size * 0.52, flexShrink: 0 }} />
      <div>{children}</div>
    </div>
  );
}

/** A chapter's opening card: big number, title, and what it covers. */
export function Chapter({ n, title, sub, items }: { n: number; title: string; sub: string; items?: string[] }) {
  const p = useIn(0, 14);
  return (
    <Scene>
      <div style={{ position: 'absolute', ...PAD, display: 'flex', alignItems: 'center', gap: 90 }}>
        <div style={{ fontSize: 300, fontWeight: 800, letterSpacing: '-0.06em', color: C.lime, lineHeight: 0.85, width: 380, textAlign: 'right', ...rise(p, 60) }}>
          {String(n).padStart(2, '0')}
        </div>
        <div style={{ flex: 1 }}>
          <Kicker delay={6}>{`Chapter ${n}`}</Kicker>
          <Title text={title} size={92} delay={10} style={{ marginTop: 16 }} />
          <Body delay={30} size={34} style={{ marginTop: 24, maxWidth: 1050 }}>{sub}</Body>
          {items ? <Bullets items={items} delay={44} step={8} size={26} /> : null}
        </div>
      </div>
    </Scene>
  );
}

/** One big statement, centred. */
export function Statement({ kicker, text, sub, highlight = [] }: { kicker?: string; text: string; sub?: string; highlight?: string[] }) {
  return (
    <Scene>
      <div style={{ position: 'absolute', ...PAD, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {kicker ? <Kicker delay={2}>{kicker}</Kicker> : null}
        <Title text={text} size={96} delay={8} highlight={highlight} style={{ marginTop: 22, maxWidth: 1550 }} />
        {sub ? <Body delay={34} size={36} style={{ marginTop: 32, maxWidth: 1350 }}>{sub}</Body> : null}
      </div>
    </Scene>
  );
}

/** A grid of icon cards, for "what you get" style summaries. */
export function Tiles({ kicker, title, tiles, cols = 3 }: { kicker?: string; title: string; tiles: { icon: string; title: string; text: string }[]; cols?: number }) {
  return (
    <Scene>
      <div style={{ position: 'absolute', ...PAD, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {kicker ? <Kicker delay={2}>{kicker}</Kicker> : null}
        <Title text={title} size={68} delay={6} style={{ marginTop: 14 }} />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 28, marginTop: 48 }}>
          {tiles.map((t, i) => (
            <TileCard key={i} {...t} delay={20 + i * 7} />
          ))}
        </div>
      </div>
    </Scene>
  );
}

function TileCard({ icon, title, text, delay }: { icon: string; title: string; text: string; delay: number }) {
  const p = useIn(delay, 17);
  return (
    <div style={{ background: C.ink2, borderRadius: 32, padding: '36px 38px', ...rise(p, 36) }}>
      <IconTile name={icon} size={76} delay={delay + 2} />
      <div style={{ fontSize: 38, fontWeight: 800, marginTop: 22, letterSpacing: '-0.015em', lineHeight: 1.12 }}>{title}</div>
      <div style={{ fontSize: 28, lineHeight: 1.42, color: 'rgba(255,255,255,0.76)', fontWeight: 500, marginTop: 12 }}>{text}</div>
    </div>
  );
}

/** Rows of label / detail, revealed in turn. */
export function Rows({ rows, delay = 0, step = 10, keyW = 300, size = 27 }: { rows: [string, string][]; delay?: number; step?: number; keyW?: number; size?: number }) {
  return (
    <div>
      {rows.map(([k, v], i) => (
        <RowItem key={i} k={k} v={v} delay={delay + i * step} keyW={keyW} size={size} />
      ))}
    </div>
  );
}

function RowItem({ k, v, delay, keyW, size }: { k: string; v: string; delay: number; keyW: number; size: number }) {
  const p = useIn(delay, 18);
  return (
    <div style={{ display: 'flex', gap: 28, padding: '18px 0', borderTop: `1px solid ${C.ink3}`, ...rise(p, 16) }}>
      <div style={{ width: keyW, flexShrink: 0, fontSize: size, fontWeight: 800, color: C.lime }}>{k}</div>
      <div style={{ flex: 1, fontSize: size, lineHeight: 1.38, color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>{v}</div>
    </div>
  );
}

/** "Who does this" tag shown beside onboarding steps. */
export function WhoTag({ who, delay = 0 }: { who: string; delay?: number }) {
  const p = useIn(delay, 14);
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderRadius: 999, background: C.ink3, color: C.lime, fontSize: 20, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: p }}>
      <div style={{ width: 9, height: 9, borderRadius: 5, background: C.lime }} />
      {who}
    </div>
  );
}

/** Onboarding step header: "Step 3 of 10" + who does it. */
export function StepHead({ n, of, who }: { n: number; of: number; who: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 6 }}>
      <Kicker delay={2}>{`Onboarding · step ${n} of ${of}`}</Kicker>
      <WhoTag who={who} delay={6} />
    </div>
  );
}

/** Onboarding step scene: step header, title and body left, visual right. */
export function Step({ n, of, who, title, body, bullets, visual, copyW = 660, size = 60 }: {
  n: number; of: number; who: string; title: string; body?: ReactNode; bullets?: string[]; visual: ReactNode; copyW?: number; size?: number;
}) {
  return (
    <Scene>
      <div style={{ position: 'absolute', ...PAD, display: 'flex', alignItems: 'center', gap: 64 }}>
        <div style={{ width: copyW, flexShrink: 0 }}>
          <StepHead n={n} of={of} who={who} />
          <Title text={title} size={size} delay={8} style={{ marginTop: 16 }} />
          {body ? <Body delay={24} size={29} style={{ marginTop: 22 }}>{body}</Body> : null}
          {bullets ? <Bullets items={bullets} delay={32} size={26} step={12} /> : null}
        </div>
        <div style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>{visual}</div>
      </div>
    </Scene>
  );
}

/** A tap ring that pulses at `at` frames, positioned absolutely. */
export function Tap({ at, x, y }: { at: number; x: number; y: number }) {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (frame < at || t >= 1) return null;
  return (
    <div style={{ position: 'absolute', left: x - 40, top: y - 40, width: 80, height: 80, borderRadius: 40, border: `5px solid ${C.lime}`, opacity: 1 - t, transform: `scale(${0.4 + t})`, zIndex: 50, pointerEvents: 'none' }} />
  );
}

/** Small caption under a visual. */
export function Caption({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: CSSProperties }) {
  const p = useIn(delay, 18);
  return <div style={{ fontSize: 21, fontWeight: 700, color: C.muted2, textAlign: 'center', marginTop: 18, opacity: p, ...style }}>{children}</div>;
}

/** Two visuals side by side with captions. */
export function Pair({ left, right, leftCap, rightCap, gap = 80 }: { left: ReactNode; right: ReactNode; leftCap?: string; rightCap?: string; gap?: number }) {
  return (
    <div style={{ display: 'flex', gap, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {left}
        {leftCap ? <Caption delay={20}>{leftCap}</Caption> : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {right}
        {rightCap ? <Caption delay={30}>{rightCap}</Caption> : null}
      </div>
    </div>
  );
}
