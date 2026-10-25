/**
 * Shared scenes (the W intro and the outro) and the sequencer that turns a
 * list of scenes into a video of exactly the slot's length.
 */
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import type { ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';

import { Body, C, Drift, FPS, Frame, Header, Icon, IconTile, Kicker, Logo, Progress, SERIES, type Series, Stage, Title, TOTAL, rise, useIn } from './kit';

export type Scene = {
  /** Seconds on screen (before the transition overlap is taken off). */
  sec: number;
  el: ReactNode;
  /** How this scene enters. */
  enter?: 'fade' | 'slide' | 'wipe';
};

const T = 16; // transition length in frames

/**
 * Scenes back to back with transitions, the last one stretched or trimmed so
 * the video is exactly `total` frames -- a 90-second slot is a 90-second slot.
 * `headerAt` holds the header back, so the intro can reveal the logo first.
 */
export function Video({ series, scenes, total = TOTAL, headerAt = 0 }: { series?: Series; scenes: Scene[]; total?: number; headerAt?: number }) {
  const frames = scenes.map((s) => Math.round(s.sec * FPS));
  const rest = frames.slice(0, -1).reduce((a, b) => a + b, 0);
  frames[frames.length - 1] = total - rest + T * (scenes.length - 1);
  if (frames[frames.length - 1] < 3 * FPS) {
    throw new Error(`${series ?? 'Intro'}: scenes run long -- the outro would be under 3s`);
  }
  return (
    <Stage>
      <TransitionSeries>
        {scenes.flatMap((s, i) => {
          const seq = (
            <TransitionSeries.Sequence key={`s${i}`} durationInFrames={frames[i]}>
              <Drift>{s.el}</Drift>
            </TransitionSeries.Sequence>
          );
          if (i === 0) return [seq];
          const timing = linearTiming({ durationInFrames: T });
          // One element per presentation: each has its own props type, and a
          // union of them does not type-check as a single prop.
          const transition =
            s.enter === 'slide' ? (
              <TransitionSeries.Transition key={`t${i}`} timing={timing} presentation={slide({ direction: 'from-right' })} />
            ) : s.enter === 'wipe' ? (
              <TransitionSeries.Transition key={`t${i}`} timing={timing} presentation={wipe({ direction: 'from-left' })} />
            ) : (
              <TransitionSeries.Transition key={`t${i}`} timing={timing} presentation={fade()} />
            );
          return [transition, seq];
        })}
      </TransitionSeries>
      <Header current={series} delay={headerAt} />
      <Progress />
    </Stage>
  );
}

/** Every scene sits on the dark stage so transitions never flash. */
export function Scene({ children }: { children: ReactNode }) {
  return <AbsoluteFill style={{ backgroundColor: C.ink }}>{children}</AbsoluteFill>;
}

/** Opening card: the W word, big, and the question it answers. */
export function WIntro({ word, question, index }: { word: string; question: string; index: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <Kicker delay={4}>{`The 5 W's · ${index} of 5`}</Kicker>
        <div style={{ display: 'flex', marginTop: 20 }}>
          {word.split('').map((ch, i) => {
            const p = spring({ frame: frame - 8 - i * 4, fps, config: { damping: 12, mass: 0.9, stiffness: 120 } });
            return (
              <span key={i} style={{ fontSize: 290, fontWeight: 800, letterSpacing: '-0.06em', lineHeight: 0.9, color: C.lime, display: 'inline-block', transform: `translateY(${(1 - p) * 160}px) rotate(${(1 - p) * -8}deg)`, opacity: Math.min(1, p * 2) }}>
                {ch}
              </span>
            );
          })}
        </div>
        <Title text={question} size={84} delay={26} style={{ marginTop: 40 }} />
      </Frame>
    </Scene>
  );
}

/** A quote-style line between sections. */
export function Statement({ kicker, text, highlight = [], sub }: { kicker?: string; text: string; highlight?: string[]; sub?: string }) {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        {kicker ? <Kicker delay={2}>{kicker}</Kicker> : null}
        <Title text={text} size={86} delay={8} highlight={highlight} style={{ marginTop: 24 }} />
        {sub ? <Body delay={30} style={{ marginTop: 34 }}>{sub}</Body> : null}
      </Frame>
    </Scene>
  );
}

function StoreRow({ icon, who, app, where, delay }: { icon: string; who: string; app: string; where: string; delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '22px 0', borderTop: `1px solid ${C.ink3}`, ...rise(p, 24) }}>
      <div style={{ width: 70, height: 70, borderRadius: 22, background: C.ink3, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={36} color={C.lime} />
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '0.12em', color: C.muted2 }}>{who.toUpperCase()}</div>
        <div style={{ fontSize: 34, fontWeight: 800, marginTop: 2 }}>{app}</div>
        <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.7)', fontWeight: 600, marginTop: 2 }}>{where}</div>
      </div>
    </div>
  );
}

/** Closing card: brand, tagline, where each person finds it, and what's next. */
export function Outro({ next, lead = 'Next in the series' }: { next?: Series; lead?: string }) {
  const p = useIn(2, 16);
  const pn = useIn(60, 18);
  const nextIdx = next ? SERIES.indexOf(next) + 1 : 0;
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <div style={rise(p, 30)}>
          <Logo size={86} />
        </div>
        <Title text="Give visitors a code, not your gate." size={70} delay={10} highlight={['code,']} style={{ marginTop: 36 }} />
        <div style={{ marginTop: 34 }}>
          <StoreRow icon="phone" who="Residents" app="My Estate Access" where="App Store & Google Play" delay={30} />
          <StoreRow icon="shield" who="Guards" app="My Estate Access Guard" where="Google Play" delay={38} />
          <StoreRow icon="globe" who="Estate office" app="app.myestateaccess.com" where="Any web browser" delay={46} />
        </div>
        {next ? (
          <div style={{ marginTop: 34, ...rise(pn, 20) }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: C.muted2 }}>{`${lead} · ${nextIdx} of 5  `}</span>
            <span style={{ fontSize: 26, fontWeight: 800, color: C.lime }}>{next.toUpperCase()}</span>
          </div>
        ) : (
          <div style={{ marginTop: 34, fontSize: 30, fontWeight: 800, color: C.lime, ...rise(pn, 20) }}>myestateaccess.com</div>
        )}
      </Frame>
    </Scene>
  );
}

/** Kicker, title and body for one side of a scene. */
export function Copy({ icon, kicker, title, body, highlight = [], size = 72, delay = 0 }: { icon?: string; kicker?: string; title: string; body?: ReactNode; highlight?: string[]; size?: number; delay?: number }) {
  return (
    <div>
      {icon ? <IconTile name={icon} size={84} delay={delay} /> : null}
      {kicker ? <div style={{ marginTop: icon ? 26 : 0 }}><Kicker delay={delay + 4}>{kicker}</Kicker></div> : null}
      <Title text={title} size={size} delay={delay + 8} highlight={highlight} style={{ marginTop: 16 }} />
      {body ? <Body delay={delay + 26} size={32} style={{ marginTop: 22 }}>{body}</Body> : null}
    </div>
  );
}

/** Copy on the left, a device on the right. */
export function Beside({ left, right, leftWidth = 470 }: { left: ReactNode; right: ReactNode; leftWidth?: number }) {
  return (
    <Scene>
      <Frame style={{ flexDirection: 'row', alignItems: 'center', gap: 40 }}>
        <div style={{ width: leftWidth, flexShrink: 0 }}>{left}</div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>{right}</div>
      </Frame>
    </Scene>
  );
}

/** Copy on top, a wide visual underneath. */
export function Above({ top, bottom }: { top: ReactNode; bottom: ReactNode }) {
  return (
    <Scene>
      <Frame>
        <div>{top}</div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 10 }}>{bottom}</div>
      </Frame>
    </Scene>
  );
}
