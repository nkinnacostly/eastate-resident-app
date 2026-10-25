/**
 * Phones and the screens shown on them.
 *
 * Simplified recreations of the real screens, using the apps' own wording
 * ("ONE ENTRY ONLY", "Let them in", "Do not admit", "Live codes N of 3").
 * Screens are laid out at 400x860 and the phone scales them.
 */
import type { CSSProperties, ReactNode } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import { C, FONT, Icon, KeyGlyph, pop, rise, useIn, useProgress } from './kit';

export const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function Phone({ children, scale = 1, style, delay = 0 }: { children: ReactNode; scale?: number; style?: CSSProperties; delay?: number }) {
  const p = useIn(delay, 18);
  const w = 400 + 28;
  const h = 860 + 28;
  return (
    <div style={{ width: w * scale, height: h * scale, flexShrink: 0, ...rise(p, 80), ...style }}>
      <div
        style={{
          width: w,
          height: h,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          background: '#0b0c0e',
          borderRadius: 64,
          padding: 14,
          boxShadow: '0 50px 90px rgba(0,0,0,0.45), inset 0 0 0 2px #2a2d33',
          position: 'relative',
        }}
      >
        <div style={{ width: 400, height: 860, borderRadius: 52, overflow: 'hidden', background: C.canvas, position: 'relative', fontFamily: FONT, color: C.ink }}>
          <div style={{ position: 'absolute', top: 12, left: '50%', marginLeft: -62, width: 124, height: 34, borderRadius: 20, background: '#0b0c0e', zIndex: 20 }} />
          <div style={{ position: 'absolute', top: 18, left: 34, fontSize: 17, fontWeight: 700, zIndex: 19 }}>9:41</div>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Resident app ────────────────────────────────────────────────────────────

export function TabBar({ active = 'Home' }: { active?: string }) {
  const tabs = [
    ['Home', 'house'],
    ['Codes', 'key'],
    ['Dues', 'money'],
    ['History', 'clock'],
    ['You', 'people'],
  ];
  return (
    <div style={{ position: 'absolute', left: 16, right: 16, bottom: 20, height: 74, borderRadius: 30, background: C.ink, display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
      {tabs.map(([t, i]) => (
        <div key={t} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: t === active ? C.lime : C.muted2, fontSize: 12, fontWeight: 700 }}>
          <Icon name={i} size={24} color={t === active ? C.lime : C.muted2} />
          {t}
        </div>
      ))}
    </div>
  );
}

/** Home: live-code count and the Generate button, which can be "pressed". */
export function ResidentHome({ live = 1, pressAt = -1, estate = 'Palm Court' }: { live?: number; pressAt?: number; estate?: string }) {
  const frame = useCurrentFrame();
  const pressed = pressAt >= 0 && frame >= pressAt && frame < pressAt + 8;
  return (
    <div style={{ padding: '78px 26px 0' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.muted }}>{estate.toUpperCase()}</div>
      <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 4 }}>Good evening, Ada</div>
      <div style={{ marginTop: 26, background: C.white, borderRadius: 28, padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.1em', color: C.muted }}>LIVE CODES</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 56, fontWeight: 800 }}>{live}</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: C.muted }}>of 3</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ flex: 1, height: 10, borderRadius: 5, background: i < live ? C.lime : C.field }} />
          ))}
        </div>
      </div>
      <div
        style={{
          marginTop: 22,
          height: 74,
          borderRadius: 28,
          background: C.lime,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          fontSize: 24,
          fontWeight: 800,
          transform: `scale(${pressed ? 0.95 : 1})`,
        }}
      >
        <KeyGlyph size={30} /> Generate code
      </div>
      <div style={{ marginTop: 18, background: C.white, borderRadius: 24, padding: '18px 22px', fontSize: 17, color: C.muted, fontWeight: 600 }}>
        A code lets one visitor in, once. It stops working after six hours.
      </div>
      <TabBar active="Home" />
    </div>
  );
}

/** The code itself, with the share actions. Letters land one by one. */
export function CodeScreen({ code = 'K7Q2MX', until = '18:40 today', delivery, landAt = 0 }: { code?: string; until?: string; delivery?: string; landAt?: number }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ padding: '80px 26px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.muted }}>{delivery ? 'DELIVERY CODE' : 'VISITOR CODE'}</div>
      <div style={{ marginTop: 30, background: C.white, borderRadius: 32, padding: '34px 10px 30px' }}>
        <div style={{ display: 'inline-block', padding: '8px 18px', borderRadius: 999, background: C.lime, fontSize: 15, fontWeight: 800, letterSpacing: '0.08em' }}>ONE ENTRY ONLY</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 24 }}>
          {code.split('').map((ch, i) => {
            const t = interpolate(frame, [landAt + i * 4, landAt + i * 4 + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <span key={i} style={{ fontSize: 60, fontWeight: 800, letterSpacing: '0.02em', opacity: t, transform: `translateY(${(1 - t) * -30}px)`, display: 'inline-block', width: 52 }}>
                {ch}
              </span>
            );
          })}
        </div>
        <div style={{ marginTop: 18, fontSize: 19, color: C.muted, fontWeight: 600 }}>Valid until {until}</div>
        {delivery ? (
          <div style={{ margin: '18px 22px 0', padding: '14px 16px', borderRadius: 18, background: C.field, fontSize: 16, fontWeight: 600, textAlign: 'left' }}>
            For the guard: {delivery}
          </div>
        ) : null}
      </div>
      <div style={{ marginTop: 22, height: 70, borderRadius: 26, background: C.ink, color: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800 }}>
        Send to visitor
      </div>
      <div style={{ marginTop: 12, height: 64, borderRadius: 26, background: C.field, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800 }}>
        Copy code
      </div>
    </div>
  );
}

/** Share sheet sliding up over the code screen. */
export function ShareSheet({ at = 0, pick = -1 }: { at?: number; pick?: number }) {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [at, at + 12], [100, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const apps = [
    ['WhatsApp', '#25d366'],
    ['SMS', '#34c759'],
    ['Email', '#3b82f6'],
    ['More', C.muted2],
  ];
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, transform: `translateY(${y}%)`, background: C.white, borderRadius: '34px 34px 0 0', padding: '20px 26px 44px', boxShadow: '0 -20px 50px rgba(0,0,0,0.18)' }}>
      <div style={{ width: 60, height: 6, borderRadius: 3, background: C.line, margin: '0 auto 18px' }} />
      <div style={{ fontSize: 18, fontWeight: 800 }}>Send to visitor</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        {apps.map(([name, color], i) => (
          <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: C.muted }}>
            <div style={{ width: 66, height: 66, borderRadius: 20, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${pick === i && frame > at + 26 ? 0.9 : 1})`, boxShadow: pick === i && frame > at + 26 ? `0 0 0 5px ${C.lime}` : 'none' }}>
              <Icon name={name === 'Email' ? 'msg' : name === 'More' ? 'link' : 'msg'} size={32} color={C.white} />
            </div>
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A push notification dropping in from the top of the phone. */
export function Notification({ at = 0, title, body }: { at?: number; title: string; body: string }) {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [at, at + 12], [-140, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', top: 58, left: 14, right: 14, transform: `translateY(${y}px)`, background: 'rgba(255,255,255,0.97)', borderRadius: 26, padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', zIndex: 30 }}>
      <div style={{ width: 46, height: 46, borderRadius: 13, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <KeyGlyph size={30} />
      </div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 15, color: C.muted, fontWeight: 600 }}>{body}</div>
      </div>
    </div>
  );
}

// ─── Guard app ───────────────────────────────────────────────────────────────

/** The guard's keypad, typing `code` between `from` and `to`. */
export function GuardCheck({ code = 'K7Q2MX', from = 0, to = 40, offline = false }: { code?: string; from?: number; to?: number; offline?: boolean }) {
  const frame = useCurrentFrame();
  const n = Math.floor(interpolate(frame, [from, to], [0, code.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const lastKey = n > 0 ? code[n - 1] : '';
  return (
    <div style={{ padding: '76px 22px 0', background: C.ink, height: '100%', color: C.white }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 34, fontWeight: 800 }}>Check</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 999, background: offline ? '#3a2d14' : C.ink3, fontSize: 14, fontWeight: 800, color: offline ? '#ffcf6b' : C.lime }}>
          <div style={{ width: 9, height: 9, borderRadius: 5, background: offline ? '#ffcf6b' : C.lime }} />
          {offline ? 'Offline' : 'Synced'} · 12 codes live
        </div>
      </div>
      <div style={{ fontSize: 15, color: C.muted2, marginTop: 6, fontWeight: 600 }}>{offline ? 'Verifying on this phone' : 'Verifying with the server'}</div>
      <div style={{ display: 'flex', gap: 9, marginTop: 26 }}>
        {code.split('').map((ch, i) => (
          <div key={i} style={{ flex: 1, height: 72, borderRadius: 16, background: i < n ? C.white : C.ink3, color: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 800, boxShadow: i === n ? `0 0 0 3px ${C.lime}` : 'none' }}>
            {i < n ? ch : ''}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 7, marginTop: 30 }}>
        {CHARSET.split('').map((ch) => (
          <div key={ch} style={{ height: 50, borderRadius: 12, background: ch === lastKey ? C.lime : C.ink2, color: ch === lastKey ? C.ink : C.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800 }}>
            {ch}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24, fontSize: 14, color: C.muted2, fontWeight: 600, textAlign: 'center' }}>No O, no 0, no I, no 1 — nothing to misread.</div>
    </div>
  );
}

/** The guard's answer. `ok` = Let them in; otherwise Do not admit + reason. */
export function Verdict({ ok, reason = 'Already used', host = 'Ada O. · House 12', offline = false, at = 0 }: { ok: boolean; reason?: string; host?: string; offline?: boolean; at?: number }) {
  const p = useIn(at, 13);
  return (
    <div style={{ height: '100%', background: ok ? C.lime : C.coral, padding: '120px 30px 0', color: C.ink }}>
      <div style={{ width: 120, height: 120, borderRadius: 60, background: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', ...pop(p) }}>
        <Icon name={ok ? 'check' : 'x'} size={70} color={ok ? C.lime : C.coral} width={2.6} />
      </div>
      <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 36, ...rise(p) }}>{ok ? 'Let them in' : 'Do not admit'}</div>
      <div style={{ marginTop: 26, background: 'rgba(22,24,28,0.08)', borderRadius: 24, padding: 22, fontSize: 20, fontWeight: 700, lineHeight: 1.5, ...rise(p) }}>
        {ok ? (
          <>
            <div>Host: {offline ? 'Not available offline' : host}</div>
            <div>Entries: One — this was it</div>
            <div style={{ fontWeight: 600, opacity: 0.75 }}>{offline ? 'It uploads when signal returns.' : 'The resident has been notified.'}</div>
          </>
        ) : (
          <>
            <div>Reason: {reason}</div>
            <div style={{ fontWeight: 600, opacity: 0.75 }}>Read it out to the visitor.</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** The message a visitor receives. Outside a phone, as a floating bubble. */
export function MessageBubble({ delay = 0, text, style }: { delay?: number; text: string; style?: CSSProperties }) {
  const p = useIn(delay, 15);
  return (
    <div style={{ background: '#e9fbd8', color: C.ink, borderRadius: '30px 30px 30px 8px', padding: '24px 28px', fontSize: 30, lineHeight: 1.35, fontWeight: 600, boxShadow: '0 24px 50px rgba(0,0,0,0.3)', maxWidth: 760, ...pop(p), ...style }}>
      {text}
      <div style={{ fontSize: 18, color: C.muted, marginTop: 8, textAlign: 'right' }}>18:02 ✓✓</div>
    </div>
  );
}

/** Dues tab with the term picker; `pickAt` moves the selection to Yearly. */
export function DuesScreen({ pickAt = 30 }: { pickAt?: number }) {
  const progress = useProgress(pickAt, pickAt + 10);
  const terms = ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'];
  const yearly = progress > 0.5;
  return (
    <div style={{ padding: '78px 24px 0' }}>
      <div style={{ fontSize: 36, fontWeight: 800 }}>Dues</div>
      <div style={{ marginTop: 18, background: C.white, borderRadius: 28, padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.1em', color: C.muted }}>OUTSTANDING</div>
        <div style={{ fontSize: 44, fontWeight: 800, marginTop: 6 }}>₦25,000</div>
        <div style={{ fontSize: 17, color: C.muted, fontWeight: 600 }}>October · due 8 Oct</div>
      </div>
      <div style={{ marginTop: 20, fontSize: 17, fontWeight: 800 }}>Pay for</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        {terms.map((t) => {
          const on = yearly ? t === 'Yearly' : t === 'Monthly';
          return (
            <div key={t} style={{ height: 56, borderRadius: 999, background: on ? C.ink : C.field, color: on ? C.white : C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800 }}>
              {t}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 22, height: 74, borderRadius: 28, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800 }}>
        {yearly ? 'Pay 12 months · ₦300,000' : 'Pay ₦25,000'}
      </div>
      <div style={{ marginTop: 14, fontSize: 15, color: C.muted, fontWeight: 600, textAlign: 'center' }}>Goes straight to the estate&apos;s bank account.</div>
      <TabBar active="Dues" />
    </div>
  );
}
