/**
 * Layouts for the trustees' walkthrough film, in two shapes from one script:
 * 16:9 (1920x1080) for laptops and boardrooms, and 9:16 (1080x1920) for
 * Reels and TikTok.
 *
 * The film is captions and visuals with music, no voice: every scene carries
 * one headline a trustee can read in two seconds and at most two short lines
 * under it, and the visual does the explaining. At 16:9 the copy sits left of
 * the visual; at 9:16 above it, inside the platforms' safe zones (clear of the
 * top bar, the caption and buttons along the bottom, and the action column on
 * the right).
 */
import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

import { Body, C, IconTile, Kicker, Title, rise, useIn } from '../kit';

export const PAD = { top: 150, left: 96, right: 96, bottom: 96 };
const PAD_VERTICAL = { top: 290, left: 80, right: 110, bottom: 400 };

/** Which shape this render is, and where content may sit in it. */
export function useLayout() {
  const { width, height } = useVideoConfig();
  const vertical = height / width > 1.5;
  const pad = vertical ? PAD_VERTICAL : PAD;
  return { vertical, pad, innerW: width - pad.left - pad.right, innerH: height - pad.top - pad.bottom };
}

/** Dark scene background, so transitions never flash. */
export function Scene({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return <AbsoluteFill style={{ backgroundColor: light ? C.canvas : C.ink }}>{children}</AbsoluteFill>;
}

/**
 * Copy beside the visual (16:9) or above it (9:16). `vZoom` scales the
 * visual in the portrait cut only, where it shares the height with the copy.
 */
export function Split({
  kicker, title, body, visual, highlight = [], copyW = 640, size = 64, bullets, vZoom = 1, head, compact = false,
}: {
  kicker?: string; title: string; body?: ReactNode; visual: ReactNode; highlight?: string[];
  copyW?: number; size?: number; bullets?: string[]; vZoom?: number; head?: ReactNode;
  /** Onboarding steps: slightly smaller copy, which carries more words. */
  compact?: boolean;
}) {
  const { vertical, pad } = useLayout();
  const copy = (
    <>
      {head}
      {kicker ? <Kicker delay={2}>{kicker}</Kicker> : null}
      <Title text={title} size={vertical ? Math.min(size, 60) : size} delay={6} highlight={highlight} style={{ marginTop: kicker || head ? (vertical ? 14 : 18) : 0 }} />
      {body ? <Body delay={22} size={vertical || compact ? 29 : 31} style={{ marginTop: vertical ? 18 : compact ? 22 : 26 }}>{body}</Body> : null}
      {bullets ? <Bullets items={bullets} delay={30} size={vertical || compact ? 26 : 28} step={compact ? 12 : 14} /> : null}
    </>
  );
  if (vertical) {
    return (
      <Scene>
        {/* Copy and visual as one group, centred in the safe area: pinning the
            copy to the top left a dead band above the platform's caption. */}
        <div style={{ position: 'absolute', ...pad, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 44 }}>
          <div>{copy}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            <div style={{ zoom: vZoom }}>{visual}</div>
          </div>
        </div>
      </Scene>
    );
  }
  return (
    <Scene>
      <div style={{ position: 'absolute', ...pad, display: 'flex', alignItems: 'center', gap: 72 }}>
        <div style={{ width: copyW, flexShrink: 0 }}>{copy}</div>
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
    <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
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
  const { vertical, pad } = useLayout();
  const num = (
    <div style={{ fontSize: vertical ? 240 : 300, fontWeight: 800, letterSpacing: '-0.06em', color: C.lime, lineHeight: 0.85, width: vertical ? undefined : 380, textAlign: vertical ? 'left' : 'right', ...rise(p, 60) }}>
      {String(n).padStart(2, '0')}
    </div>
  );
  return (
    <Scene>
      <div style={{ position: 'absolute', ...pad, display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: vertical ? 'flex-start' : 'center', justifyContent: 'center', gap: vertical ? 40 : 90 }}>
        {num}
        <div style={{ flex: vertical ? undefined : 1 }}>
          <Kicker delay={6}>{`Chapter ${n}`}</Kicker>
          <Title text={title} size={vertical ? 80 : 92} delay={10} style={{ marginTop: 16 }} />
          <Body delay={30} size={vertical ? 32 : 34} style={{ marginTop: 24, maxWidth: 1050 }}>{sub}</Body>
          {items ? <Bullets items={items} delay={44} step={8} size={26} /> : null}
        </div>
      </div>
    </Scene>
  );
}

/** One big statement, centred. */
export function Statement({ kicker, text, sub, highlight = [] }: { kicker?: string; text: string; sub?: string; highlight?: string[] }) {
  const { vertical, pad } = useLayout();
  return (
    <Scene>
      <div style={{ position: 'absolute', ...pad, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {kicker ? <Kicker delay={2}>{kicker}</Kicker> : null}
        <Title text={text} size={vertical ? 82 : 96} delay={8} highlight={highlight} style={{ marginTop: 22, maxWidth: 1550 }} />
        {sub ? <Body delay={34} size={vertical ? 32 : 36} style={{ marginTop: 32, maxWidth: 1350 }}>{sub}</Body> : null}
      </div>
    </Scene>
  );
}

/** A grid of icon cards (16:9), or a stacked list of them (9:16). */
export function Tiles({ kicker, title, tiles, cols = 3 }: { kicker?: string; title: string; tiles: { icon: string; title: string; text: string }[]; cols?: number }) {
  const { vertical, pad } = useLayout();
  return (
    <Scene>
      <div style={{ position: 'absolute', ...pad, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {kicker ? <Kicker delay={2}>{kicker}</Kicker> : null}
        <Title text={title} size={vertical ? 58 : 68} delay={6} style={{ marginTop: 14 }} />
        <div style={{ display: 'grid', gridTemplateColumns: vertical ? '1fr' : `repeat(${cols}, 1fr)`, gap: vertical ? 18 : 28, marginTop: vertical ? 36 : 48 }}>
          {tiles.map((t, i) => (
            <TileCard key={i} {...t} delay={20 + i * 7} row={vertical} />
          ))}
        </div>
      </div>
    </Scene>
  );
}

function TileCard({ icon, title, text, delay, row }: { icon: string; title: string; text: string; delay: number; row: boolean }) {
  const p = useIn(delay, 17);
  if (row) {
    return (
      <div style={{ background: C.ink2, borderRadius: 28, padding: '26px 28px', display: 'flex', gap: 22, alignItems: 'flex-start', ...rise(p, 30) }}>
        <IconTile name={icon} size={64} delay={delay + 2} />
        <div>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.015em', lineHeight: 1.12 }}>{title}</div>
          <div style={{ fontSize: 25, lineHeight: 1.4, color: 'rgba(255,255,255,0.76)', fontWeight: 500, marginTop: 8 }}>{text}</div>
        </div>
      </div>
    );
  }
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
  const { vertical } = useLayout();
  return (
    <div style={{ width: vertical ? '100%' : undefined }}>
      {rows.map(([k, v], i) => (
        <RowItem key={i} k={k} v={v} delay={delay + i * step} keyW={vertical ? Math.min(keyW, 270) : keyW} size={vertical ? Math.min(size, 26) : size} />
      ))}
    </div>
  );
}

function RowItem({ k, v, delay, keyW, size }: { k: string; v: string; delay: number; keyW: number; size: number }) {
  const p = useIn(delay, 18);
  return (
    <div style={{ display: 'flex', gap: 24, padding: '16px 0', borderTop: `1px solid ${C.ink3}`, ...rise(p, 16) }}>
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

/** Onboarding step header: "Step 3 of 13" + who does it. */
export function StepHead({ n, of, who }: { n: number; of: number; who: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 6, flexWrap: 'wrap' }}>
      <Kicker delay={2}>{`Onboarding · step ${n} of ${of}`}</Kicker>
      <WhoTag who={who} delay={6} />
    </div>
  );
}

/** Onboarding step scene: step header and copy beside (or above) the visual. */
export function Step({ n, of, who, title, body, bullets, visual, copyW = 660, size = 60, vZoom = 1 }: {
  n: number; of: number; who: string; title: string; body?: ReactNode; bullets?: string[]; visual: ReactNode; copyW?: number; size?: number; vZoom?: number;
}) {
  return (
    <Split compact head={<StepHead n={n} of={of} who={who} />} title={title} body={body} bullets={bullets} visual={visual} copyW={copyW} size={size} vZoom={vZoom} />
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
  const { vertical } = useLayout();
  return (
    <div style={{ display: 'flex', gap: vertical ? Math.min(gap, 44) : gap, alignItems: 'flex-start' }}>
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
