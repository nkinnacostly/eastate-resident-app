/**
 * Phone screens for the trustees' film, drawn at 400x860 inside <Phone>.
 *
 * Wording is the apps' own, checked against apps/resident and apps/guard on
 * 26 Nov 2026 ("Join your estate", "Request access", "Waiting on approval",
 * "Is this code for a delivery?", "Send QR pass", "Check a code", "Scan
 * visitor QR", "CHECKED ON THIS PHONE", "Admit anyway and flag it", ...).
 * Names, codes and amounts are examples for a South African estate.
 */
import type { CSSProperties, ReactNode } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import { C, Icon, KeyGlyph, pop, rise, useIn } from '../kit';
import { CHARSET } from '../phone';

export const ESTATE = 'Silver Oaks Estate';
export const CODE = 'K7Q2MX';
export const ESTATE_CODE = 'HXR4TQ7M';
export const HOUSE_CODE = 'K2P9';
export const HOUSE = '1021';
export const RESIDENT = 'Thandi Nkosi';
export const GUARD = 'Thabo Mokoena';

/** The real QR for K7Q2MX at error correction H (qrcode 1.5.4), as the app draws it. */
export const QR = {
  extent: 29,
  d: 'M4 4h7v1h-7zM12 4h3v1h-3zM18 4h7v1h-7zM4 5h1v1h-1zM10 5h1v1h-1zM13 5h1v1h-1zM15 5h2v1h-2zM18 5h1v1h-1zM24 5h1v1h-1zM4 6h1v1h-1zM6 6h3v1h-3zM10 6h1v1h-1zM14 6h3v1h-3zM18 6h1v1h-1zM20 6h3v1h-3zM24 6h1v1h-1zM4 7h1v1h-1zM6 7h3v1h-3zM10 7h1v1h-1zM12 7h1v1h-1zM14 7h2v1h-2zM18 7h1v1h-1zM20 7h3v1h-3zM24 7h1v1h-1zM4 8h1v1h-1zM6 8h3v1h-3zM10 8h1v1h-1zM12 8h1v1h-1zM18 8h1v1h-1zM20 8h3v1h-3zM24 8h1v1h-1zM4 9h1v1h-1zM10 9h1v1h-1zM12 9h2v1h-2zM15 9h2v1h-2zM18 9h1v1h-1zM24 9h1v1h-1zM4 10h7v1h-7zM12 10h1v1h-1zM14 10h1v1h-1zM16 10h1v1h-1zM18 10h7v1h-7zM12 11h1v1h-1zM14 11h1v1h-1zM4 12h1v1h-1zM6 12h5v1h-5zM12 12h2v1h-2zM16 12h2v1h-2zM19 12h1v1h-1zM21 12h1v1h-1zM23 12h2v1h-2zM5 13h1v1h-1zM8 13h1v1h-1zM11 13h1v1h-1zM13 13h1v1h-1zM15 13h1v1h-1zM18 13h1v1h-1zM20 13h1v1h-1zM24 13h1v1h-1zM4 14h1v1h-1zM7 14h1v1h-1zM9 14h2v1h-2zM12 14h1v1h-1zM14 14h1v1h-1zM16 14h1v1h-1zM18 14h1v1h-1zM20 14h3v1h-3zM6 15h2v1h-2zM9 15h1v1h-1zM12 15h4v1h-4zM17 15h1v1h-1zM19 15h1v1h-1zM21 15h3v1h-3zM4 16h1v1h-1zM6 16h1v1h-1zM10 16h2v1h-2zM13 16h1v1h-1zM16 16h1v1h-1zM18 16h1v1h-1zM20 16h1v1h-1zM23 16h1v1h-1zM12 17h1v1h-1zM14 17h1v1h-1zM16 17h1v1h-1zM18 17h1v1h-1zM22 17h3v1h-3zM4 18h7v1h-7zM12 18h3v1h-3zM16 18h2v1h-2zM19 18h4v1h-4zM4 19h1v1h-1zM10 19h1v1h-1zM12 19h1v1h-1zM15 19h1v1h-1zM18 19h1v1h-1zM21 19h1v1h-1zM24 19h1v1h-1zM4 20h1v1h-1zM6 20h3v1h-3zM10 20h1v1h-1zM12 20h1v1h-1zM14 20h1v1h-1zM16 20h3v1h-3zM20 20h1v1h-1zM22 20h1v1h-1zM4 21h1v1h-1zM6 21h3v1h-3zM10 21h1v1h-1zM13 21h1v1h-1zM15 21h3v1h-3zM20 21h4v1h-4zM4 22h1v1h-1zM6 22h3v1h-3zM10 22h1v1h-1zM12 22h1v1h-1zM14 22h1v1h-1zM17 22h3v1h-3zM21 22h1v1h-1zM23 22h1v1h-1zM4 23h1v1h-1zM10 23h1v1h-1zM12 23h1v1h-1zM15 23h1v1h-1zM18 23h1v1h-1zM20 23h1v1h-1zM24 23h1v1h-1zM4 24h7v1h-7zM12 24h1v1h-1zM14 24h4v1h-4zM20 24h5v1h-5z',
};

export function QrCode({ size = 176 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${QR.extent} ${QR.extent}`} shapeRendering="crispEdges">
      <rect width={QR.extent} height={QR.extent} fill="#fff" />
      <path d={QR.d} fill={C.ink} />
    </svg>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

const pad = (top = 78): CSSProperties => ({ padding: `${top}px 24px 0` });
const eyebrow: CSSProperties = { fontSize: 14, fontWeight: 800, letterSpacing: '0.1em', color: C.muted };

function Field({ label, value, typeFrom, typeTo, secret = false, dark = false }: { label: string; value: string; typeFrom?: number; typeTo?: number; secret?: boolean; dark?: boolean }) {
  const frame = useCurrentFrame();
  const n = typeFrom === undefined ? value.length : Math.floor(interpolate(frame, [typeFrom, typeTo ?? typeFrom + 24], [0, value.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const shown = secret ? '•'.repeat(n) : value.slice(0, n);
  const typing = typeFrom !== undefined && n > 0 && n < value.length;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ ...eyebrow, fontSize: 12, color: dark ? C.muted2 : C.muted }}>{label}</div>
      <div style={{ marginTop: 6, height: 52, borderRadius: 16, background: dark ? C.ink2 : C.field, display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: 19, fontWeight: 700, color: dark ? C.white : C.ink, letterSpacing: secret ? '0.1em' : '0.01em', boxShadow: typing ? `0 0 0 2px ${C.lime}` : 'none' }}>
        {shown}
        {typing ? <span style={{ width: 2, height: 22, background: dark ? C.lime : C.ink, marginLeft: 2 }} /> : null}
      </div>
    </div>
  );
}

function Btn({ children, tone = 'lime', pressAt, style }: { children: ReactNode; tone?: 'lime' | 'ink' | 'field' | 'coral'; pressAt?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const pressed = pressAt !== undefined && frame >= pressAt && frame < pressAt + 8;
  const tones = { lime: [C.lime, C.ink], ink: [C.ink, C.white], field: [C.field, C.ink], coral: [C.coral, C.ink] }[tone];
  return (
    <div style={{ height: 62, borderRadius: 24, background: tones[0], color: tones[1], display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 20, fontWeight: 800, transform: `scale(${pressed ? 0.95 : 1})`, boxShadow: pressed ? `0 0 0 4px ${C.lime}` : 'none', ...style }}>
      {children}
    </div>
  );
}

export function TabBar({ active = 'Home' }: { active?: string }) {
  const tabs = [['Home', 'house'], ['Codes', 'key'], ['Dues', 'money'], ['History', 'clock'], ['You', 'people']];
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

/** A notification dropping in from the top of the phone. */
export function Push({ at = 0, title, body }: { at?: number; title: string; body: string }) {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [at, at + 12], [-160, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', top: 58, left: 14, right: 14, transform: `translateY(${y}px)`, background: 'rgba(255,255,255,0.98)', borderRadius: 26, padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.22)', zIndex: 30, color: C.ink }}>
      <div style={{ width: 46, height: 46, borderRadius: 13, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <KeyGlyph size={30} />
      </div>
      <div>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 15, color: C.muted, fontWeight: 600, lineHeight: 1.3 }}>{body}</div>
      </div>
    </div>
  );
}

// ─── Resident app ────────────────────────────────────────────────────────────

/** Sign-up: "Join your estate", with both codes. */
export function SignUp({ from = 10 }: { from?: number }) {
  return (
    <div style={pad(70)}>
      <div style={{ fontSize: 33, fontWeight: 800, letterSpacing: '-0.03em' }}>Join your estate</div>
      <div style={{ fontSize: 16, color: C.muted, fontWeight: 600, marginTop: 6 }}>Your admin has to approve you before codes work.</div>
      <Field label="FULL NAME" value={RESIDENT} typeFrom={from} typeTo={from + 16} />
      <Field label="EMAIL" value="thandi@example.com" typeFrom={from + 18} typeTo={from + 36} />
      <Field label="PASSWORD" value="silveroaks21" secret typeFrom={from + 38} typeTo={from + 50} />
      <div style={{ ...eyebrow, marginTop: 22 }}>WHERE YOU LIVE</div>
      <div style={{ fontSize: 14, color: C.muted, fontWeight: 600, marginTop: 4, lineHeight: 1.35 }}>Two codes: one from your estate, one from your landlord.</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1.4 }}><Field label="ESTATE CODE" value={ESTATE_CODE} typeFrom={from + 54} typeTo={from + 70} /></div>
        <div style={{ flex: 1 }}><Field label="HOUSE CODE" value={HOUSE_CODE} typeFrom={from + 72} typeTo={from + 82} /></div>
      </div>
      <Btn pressAt={from + 92} style={{ marginTop: 24 }}>Request access</Btn>
    </div>
  );
}

export function ConfirmEmail({ from = 6 }: { from?: number }) {
  const frame = useCurrentFrame();
  const digits = '418205';
  const n = Math.floor(interpolate(frame, [from, from + 30], [0, 6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  return (
    <div style={pad(110)}>
      <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>Confirm your email</div>
      <div style={{ fontSize: 17, color: C.muted, fontWeight: 600, marginTop: 10, lineHeight: 1.4 }}>Enter the code we emailed to thandi@example.com.</div>
      <div style={{ display: 'flex', gap: 9, marginTop: 30 }}>
        {digits.split('').map((d, i) => (
          <div key={i} style={{ flex: 1, height: 66, borderRadius: 16, background: C.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800, boxShadow: i === n ? `0 0 0 3px ${C.lime}` : 'none' }}>
            {i < n ? d : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Waiting() {
  return (
    <div style={pad(140)}>
      <div style={{ width: 96, height: 96, borderRadius: 30, background: C.field, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="clock" size={50} color={C.ink} />
      </div>
      <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 28 }}>Waiting on approval</div>
      <div style={{ fontSize: 18, color: C.muted, fontWeight: 600, marginTop: 12, lineHeight: 1.45 }}>
        An estate admin has to approve you before you can make codes. You will see this screen until they do.
      </div>
      <Btn tone="field" style={{ marginTop: 30 }}>Check again</Btn>
    </div>
  );
}

export function Home({ live = 1, pressAt }: { live?: number; pressAt?: number }) {
  return (
    <div style={pad(78)}>
      <div style={eyebrow}>{ESTATE.toUpperCase()}</div>
      <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 4 }}>Good evening, Thandi</div>
      <div style={{ marginTop: 24, background: C.white, borderRadius: 28, padding: 24 }}>
        <div style={eyebrow}>LIVE CODES</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 56, fontWeight: 800 }}>{live}</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: C.muted }}>of 3</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ flex: 1, height: 10, borderRadius: 5, background: i < live ? C.lime : C.field }} />)}
        </div>
      </div>
      <Btn pressAt={pressAt} style={{ marginTop: 22, height: 74, fontSize: 23 }}><KeyGlyph size={30} /> Generate code</Btn>
      <TabBar active="Home" />
    </div>
  );
}

export function DeliveryPrompt({ pressAt }: { pressAt?: number }) {
  return (
    <div style={{ height: '100%', position: 'relative' }}>
      <div style={{ ...pad(78), opacity: 0.35 }}><div style={{ fontSize: 34, fontWeight: 800 }}>Good evening, Thandi</div></div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: C.white, borderRadius: '34px 34px 0 0', padding: '28px 24px 44px', boxShadow: '0 -20px 50px rgba(0,0,0,0.15)' }}>
        <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.02em' }}>Is this code for a delivery?</div>
        <Btn tone="ink" pressAt={pressAt} style={{ marginTop: 22 }}>Yes, it is a delivery</Btn>
        <Btn tone="field" style={{ marginTop: 10 }}>No, a visitor</Btn>
      </div>
    </div>
  );
}

export function DeliveryNote({ from = 6 }: { from?: number }) {
  const note = 'Leave it at the gatehouse';
  const frame = useCurrentFrame();
  const n = Math.floor(interpolate(frame, [from, from + 30], [0, note.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  return (
    <div style={pad(100)}>
      <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em' }}>Delivery instructions</div>
      <div style={{ fontSize: 16, color: C.muted, fontWeight: 600, marginTop: 8, lineHeight: 1.4 }}>Optional — leave it empty and the code still works.</div>
      <div style={{ marginTop: 22, height: 130, borderRadius: 20, background: C.white, padding: 18, fontSize: 20, fontWeight: 600 }}>{note.slice(0, n)}</div>
      <div style={{ fontSize: 14, color: C.muted, fontWeight: 700, marginTop: 8, textAlign: 'right' }}>{200 - n} characters left</div>
      <Btn pressAt={from + 44} style={{ marginTop: 18 }}>Generate code</Btn>
    </div>
  );
}

/** The code screen: the lime pass, which is also the picture "Send QR pass" shares. */
export function Pass({ delivery = true, until = 'Valid until 21:42 tonight', landAt = 4 }: { delivery?: boolean; until?: string; landAt?: number }) {
  const p = useIn(landAt, 16);
  return (
    <div style={pad(64)}>
      <div style={{ fontSize: 18, fontWeight: 800 }}>Your code</div>
      <div style={{ marginTop: 12, background: C.lime, borderRadius: 30, padding: '20px 18px 18px', textAlign: 'center', ...pop(p) }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{ESTATE}</div>
        <div style={{ marginTop: 12, display: 'inline-block', borderRadius: 14, overflow: 'hidden' }}><QrCode size={164} /></div>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '0.08em', marginTop: 8 }}>{CODE}</div>
        <div style={{ fontSize: 15, fontWeight: 700, opacity: 0.7 }}>{until}</div>
        {delivery ? (
          <div style={{ marginTop: 10, background: C.white, borderRadius: 14, padding: '9px 12px', textAlign: 'left' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: C.muted }}>DELIVERY</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Leave it at the gatehouse</div>
          </div>
        ) : null}
        <div style={{ display: 'inline-block', marginTop: 10, padding: '6px 14px', borderRadius: 999, background: C.ink, color: C.lime, fontSize: 13, fontWeight: 800, letterSpacing: '0.08em' }}>ONE ENTRY ONLY</div>
        <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, marginTop: 8 }}>Show the QR at the gate or read out the code.</div>
      </div>
      <Btn tone="ink" style={{ marginTop: 14, height: 56 }}>Send to visitor</Btn>
      <Btn tone="field" style={{ marginTop: 8, height: 50, fontSize: 18 }}>Copy code</Btn>
    </div>
  );
}

/** "Send K7Q2MX": the QR pass, or the text by WhatsApp / SMS / Email. */
export function SendSheet({ at = 0, pick = 'qr' }: { at?: number; pick?: 'qr' | 'whatsapp' }) {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [at, at + 12], [100, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const picked = frame > at + 34;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Pass landAt={-30} />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)', opacity: interpolate(frame, [at, at + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, transform: `translateY(${y}%)`, background: C.white, borderRadius: '34px 34px 0 0', padding: '18px 22px 34px' }}>
        <div style={{ width: 60, height: 6, borderRadius: 3, background: C.line, margin: '0 auto 14px' }} />
        <div style={{ fontSize: 22, fontWeight: 800 }}>Send {CODE}</div>
        <Btn tone="lime" style={{ marginTop: 14, boxShadow: picked && pick === 'qr' ? `0 0 0 4px ${C.ink}` : 'none' }}>Send QR pass</Btn>
        <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 8, lineHeight: 1.35 }}>The card above as an image. The guard scans it, even with no signal at the gate.</div>
        <div style={{ ...eyebrow, fontSize: 12, marginTop: 14 }}>OR SEND AS TEXT</div>
        <div style={{ marginTop: 8, background: C.field, borderRadius: 16, padding: '10px 12px', fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>
          Your code for {ESTATE} is {CODE}. Valid until 21:42 tonight.
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          {[['WhatsApp', '#25d366'], ['SMS', '#34c759'], ['Email', '#3b82f6'], ['More', C.muted2]].map(([n, col]) => (
            <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: C.muted }}>
              <div style={{ width: 56, height: 56, borderRadius: 18, background: col, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: picked && pick === 'whatsapp' && n === 'WhatsApp' ? `0 0 0 4px ${C.lime}` : 'none' }}>
                <Icon name={n === 'More' ? 'link' : 'msg'} size={28} color={C.white} />
              </div>
              {n}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The visitor's WhatsApp chat with the pass in it. */
export function VisitorChat({ at = 0 }: { at?: number }) {
  const p = useIn(at, 16);
  const p2 = useIn(at + 16, 16);
  return (
    <div style={{ height: '100%', background: '#ece5dd' }}>
      <div style={{ height: 120, background: '#075e54', display: 'flex', alignItems: 'flex-end', padding: '0 20px 16px', color: C.white, gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 22, background: '#9ad8c8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#075e54' }}>TN</div>
        <div><div style={{ fontSize: 19, fontWeight: 800 }}>Thandi</div><div style={{ fontSize: 13, opacity: 0.8 }}>online</div></div>
      </div>
      <div style={{ padding: '20px 16px' }}>
        <div style={{ background: C.white, borderRadius: '18px 18px 18px 4px', padding: 8, width: 250, ...pop(p) }}>
          <div style={{ background: C.lime, borderRadius: 14, padding: '14px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 800 }}>{ESTATE}</div>
            <div style={{ marginTop: 8, display: 'inline-block', borderRadius: 8, overflow: 'hidden' }}><QrCode size={120} /></div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '0.08em' }}>{CODE}</div>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7 }}>Valid until 21:42 tonight</div>
          </div>
          <div style={{ fontSize: 11, color: C.muted, textAlign: 'right', marginTop: 4 }}>18:42</div>
        </div>
        <div style={{ background: C.white, borderRadius: '18px 18px 18px 4px', padding: '10px 14px', width: 240, marginTop: 10, fontSize: 15, fontWeight: 600, ...pop(p2) }}>
          Show this at the gate, see you soon
          <div style={{ fontSize: 11, color: C.muted, textAlign: 'right', marginTop: 2 }}>18:42</div>
        </div>
      </div>
    </div>
  );
}

export function CodesTab() {
  const codes = [[CODE, '5h 12m', 'Delivery'], ['R4TN8W', '2h 40m', 'Visitor']];
  return (
    <div style={pad(78)}>
      <div style={{ fontSize: 34, fontWeight: 800 }}>Codes</div>
      <div style={{ fontSize: 15, color: C.muted, fontWeight: 600, marginTop: 6, lineHeight: 1.4 }}>2 of 3 slots in use. Codes die after six hours whether or not anyone arrives.</div>
      {codes.map(([c, left, kind]) => (
        <div key={c} style={{ marginTop: 14, background: C.white, borderRadius: 22, padding: '18px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '0.06em' }}>{c}</div><div style={{ fontSize: 14, color: C.muted, fontWeight: 700 }}>{kind}</div></div>
          <div style={{ padding: '8px 14px', borderRadius: 999, background: C.limeSoft, color: C.limeInk, fontSize: 16, fontWeight: 800 }}>{left}</div>
        </div>
      ))}
      <TabBar active="Codes" />
    </div>
  );
}

export function HistoryTab() {
  const rows = [[CODE, 'Used 18:51'], ['R4TN8W', 'Live'], ['P8XZ2D', 'Never used'], ['N3QW7K', 'Used 26 Nov 07:12']];
  return (
    <div style={pad(78)}>
      <div style={{ fontSize: 34, fontWeight: 800 }}>History</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {['All', 'Used', 'Expired'].map((f, i) => <div key={f} style={{ padding: '8px 16px', borderRadius: 999, background: i === 0 ? C.ink : C.field, color: i === 0 ? C.white : C.muted, fontSize: 15, fontWeight: 800 }}>{f}</div>)}
      </div>
      {rows.map(([c, s]) => (
        <div key={c} style={{ marginTop: 10, background: C.white, borderRadius: 18, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800 }}>
          <span style={{ letterSpacing: '0.06em' }}>{c}</span><span style={{ color: C.muted, fontWeight: 700 }}>{s}</span>
        </div>
      ))}
      <TabBar active="History" />
    </div>
  );
}

/** Dues tab for a resident who pays (per-resident billing), in rand. */
export function DuesTab({ pickAt = 40 }: { pickAt?: number }) {
  const frame = useCurrentFrame();
  const yearly = frame > pickAt;
  return (
    <div style={pad(72)}>
      <div style={{ fontSize: 34, fontWeight: 800 }}>Dues</div>
      <div style={{ marginTop: 14, background: C.white, borderRadius: 26, padding: 20 }}>
        <div style={eyebrow}>OUTSTANDING</div>
        <div style={{ fontSize: 40, fontWeight: 800, marginTop: 4 }}>R 1 850</div>
      </div>
      <div style={{ marginTop: 10, background: C.white, borderRadius: 26, padding: 20 }}>
        <div style={eyebrow}>NEXT PAYMENT</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}><span style={{ fontSize: 26, fontWeight: 800 }}>R 1 850</span><span style={{ fontSize: 16, fontWeight: 700, color: C.muted }}>December 2026</span></div>
        <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 4 }}>Due 8 Dec 2026 — that is 7 days after the 1st.</div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 16 }}>To pay</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        {['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'].map((t) => {
          const on = yearly ? t === 'Yearly' : t === 'Monthly';
          return <div key={t} style={{ height: 46, borderRadius: 999, background: on ? C.ink : C.field, color: on ? C.white : C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800 }}>{t}</div>;
        })}
      </div>
      <Btn style={{ marginTop: 12 }}>{yearly ? 'Pay 12 months · R 22 200' : 'Pay R 1 850'}</Btn>
      <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, textAlign: 'center', marginTop: 8, lineHeight: 1.35 }}>Payments are handled by Flutterwave. We never see or store your full card number.</div>
      <TabBar active="Dues" />
    </div>
  );
}

export function YouTab() {
  return (
    <div style={pad(72)}>
      <div style={{ fontSize: 34, fontWeight: 800 }}>You</div>
      <div style={{ ...eyebrow, marginTop: 16 }}>YOUR ESTATES</div>
      <div style={{ marginTop: 8, background: C.white, borderRadius: 20, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 18, fontWeight: 800 }}>
        {ESTATE}<span style={{ padding: '5px 12px', borderRadius: 999, background: C.limeSoft, color: C.limeInk, fontSize: 13 }}>Current</span>
      </div>
      <div style={{ ...eyebrow, marginTop: 18 }}>SOMEONE ELSE IN YOUR HOUSE?</div>
      <div style={{ marginTop: 8, background: C.white, borderRadius: 20, padding: '16px 18px' }}>
        <div style={{ fontSize: 14, color: C.muted, fontWeight: 700 }}>House {HOUSE} · house code</div>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '0.1em' }}>{HOUSE_CODE}</div>
        <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 6, lineHeight: 1.4 }}>They sign up, then enter this estate&apos;s code and your house code. An admin approves them the same way they approved you.</div>
      </div>
      <div style={{ ...eyebrow, marginTop: 18 }}>SECURITY</div>
      <div style={{ marginTop: 8, background: C.white, borderRadius: 20, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 17, fontWeight: 800 }}>
        Face ID lock
        <div style={{ width: 52, height: 30, borderRadius: 15, background: C.lime, position: 'relative' }}><div style={{ position: 'absolute', right: 3, top: 3, width: 24, height: 24, borderRadius: 12, background: C.white }} /></div>
      </div>
      <TabBar active="You" />
    </div>
  );
}

// ─── Guard app ───────────────────────────────────────────────────────────────

const gpad = (top = 78): CSSProperties => ({ padding: `${top}px 22px 0`, background: C.ink, height: '100%', color: C.white });

export function StartShift({ from = 8 }: { from?: number }) {
  return (
    <div style={gpad(90)}>
      <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>Start your shift</div>
      <div style={{ fontSize: 16, color: C.muted2, fontWeight: 600, marginTop: 8, lineHeight: 1.4 }}>Signing in downloads live codes so the gate works without signal.</div>
      <Field dark label="EMAIL" value="thabo@example.com" typeFrom={from} typeTo={from + 20} />
      <Field dark label="PASSWORD" value="gatehouse26" secret typeFrom={from + 22} typeTo={from + 34} />
      <Btn pressAt={from + 44} style={{ marginTop: 24 }}>Sign in and sync</Btn>
      <div style={{ fontSize: 13, color: C.muted2, fontWeight: 600, marginTop: 16, lineHeight: 1.4 }}>One guard verifies per gate at a time. Ending your shift hands over the post.</div>
    </div>
  );
}

export function ChoosePassword({ from = 8 }: { from?: number }) {
  return (
    <div style={gpad(110)}>
      <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em' }}>Choose your own password</div>
      <Field dark label="NEW PASSWORD" value="gatehouse26" secret typeFrom={from} typeTo={from + 14} />
      <Field dark label="REPEAT IT" value="gatehouse26" secret typeFrom={from + 16} typeTo={from + 30} />
      <Btn pressAt={from + 40} style={{ marginTop: 24 }}>Save and start</Btn>
    </div>
  );
}

/** "Check a code": keypad typing `code` between `from` and `to`. */
export function Keypad({ code = CODE, from = 0, to = 40, offline = false, pool = 214 }: { code?: string; from?: number; to?: number; offline?: boolean; pool?: number }) {
  const frame = useCurrentFrame();
  const n = Math.floor(interpolate(frame, [from, to], [0, code.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const last = n > 0 ? code[n - 1] : '';
  return (
    <div style={gpad(74)}>
      <div style={{ ...eyebrow, color: C.muted2 }}>{ESTATE.toUpperCase()}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <div style={{ fontSize: 30, fontWeight: 800 }}>Check a code</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, background: offline ? '#3a2d14' : C.ink3, fontSize: 13, fontWeight: 800, color: offline ? '#ffcf6b' : C.lime }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: offline ? '#ffcf6b' : C.lime }} />{offline ? 'Offline' : 'Synced'}
        </div>
      </div>
      <div style={{ fontSize: 14, color: C.muted2, marginTop: 4, fontWeight: 600 }}>{offline ? `Checking against ${pool} codes held on this phone` : `${pool} codes live`}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        {code.split('').map((ch, i) => (
          <div key={i} style={{ flex: 1, height: 66, borderRadius: 15, background: i < n ? C.white : C.ink3, color: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 800, boxShadow: i === n ? `0 0 0 3px ${C.lime}` : 'none' }}>{i < n ? ch : ''}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, marginTop: 22 }}>
        {CHARSET.split('').map((ch) => (
          <div key={ch} style={{ height: 46, borderRadius: 11, background: ch === last ? C.lime : C.ink2, color: ch === last ? C.ink : C.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, fontWeight: 800 }}>{ch}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: 8, marginTop: 10 }}>
        <div style={{ height: 52, borderRadius: 14, background: C.ink2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800 }}>Delete</div>
        <div style={{ height: 52, borderRadius: 14, background: C.ink2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800 }}>Scan</div>
        <div style={{ height: 52, borderRadius: 14, background: n === code.length ? C.lime : C.ink3, color: n === code.length ? C.ink : C.muted2, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800 }}>Check</div>
      </div>
    </div>
  );
}

export function ScanScreen({ at = 0 }: { at?: number }) {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [at, at + 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ ...gpad(74), background: '#0b0c0e' }}>
      <div style={{ fontSize: 30, fontWeight: 800 }}>Scan visitor QR</div>
      <div style={{ position: 'relative', margin: '40px auto 0', width: 300, height: 300 }}>
        <div style={{ position: 'absolute', left: 50, top: 50, width: 200, height: 200, background: C.lime, borderRadius: 16, padding: 18, transform: `scale(${0.75 + 0.25 * t}) rotate(${(1 - t) * -8}deg)`, opacity: Math.min(1, t * 2) }}>
          <QrCode size={164} />
        </div>
        {[[0, 0, 1, 1], [1, 0, -1, 1], [0, 1, 1, -1], [1, 1, -1, -1]].map(([x, y, dx, dy], i) => (
          <div key={i} style={{ position: 'absolute', left: x * 300 - (x ? 50 : 0), top: y * 300 - (y ? 50 : 0), width: 50, height: 50, borderLeft: dx > 0 ? `6px solid ${C.lime}` : 'none', borderRight: dx < 0 ? `6px solid ${C.lime}` : 'none', borderTop: dy > 0 ? `6px solid ${C.lime}` : 'none', borderBottom: dy < 0 ? `6px solid ${C.lime}` : 'none', borderRadius: 8 }} />
        ))}
      </div>
      <div style={{ fontSize: 17, color: C.muted2, fontWeight: 600, textAlign: 'center', marginTop: 26 }}>Hold the QR inside the square.</div>
      <Btn tone="field" style={{ marginTop: 30, background: C.ink2, color: C.white }}>Type the code instead</Btn>
    </div>
  );
}

export function GuardVerdict({ ok, reason = 'Already used', offline = false, at = 0 }: { ok: boolean; reason?: string; offline?: boolean; at?: number }) {
  const p = useIn(at, 13);
  return (
    <div style={{ height: '100%', background: ok ? C.lime : C.coral, padding: '110px 28px 0', color: C.ink }}>
      <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.12em', opacity: 0.7 }}>{offline ? 'CHECKED ON THIS PHONE' : 'CHECKED WITH THE SERVER'}</div>
      <div style={{ width: 110, height: 110, borderRadius: 55, background: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 20, ...pop(p) }}>
        <Icon name={ok ? 'check' : 'x'} size={64} color={ok ? C.lime : C.coral} width={2.6} />
      </div>
      <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 28, ...rise(p) }}>{ok ? 'Let them in' : 'Do not admit'}</div>
      <div style={{ marginTop: 22, background: 'rgba(22,24,28,0.08)', borderRadius: 22, padding: 20, fontSize: 19, fontWeight: 700, lineHeight: 1.55, ...rise(p) }}>
        {ok ? (
          <>
            <div>Host: {offline ? 'Not available offline' : `${RESIDENT} · House ${HOUSE}`}</div>
            <div>Entries: One — this was it</div>
          </>
        ) : (
          <div>{reason}</div>
        )}
      </div>
    </div>
  );
}

/** Offline refusal with the judgement-call button, then the flagged entry. */
export function FlagFlow({ pressAt = 40 }: { pressAt?: number }) {
  const frame = useCurrentFrame();
  if (frame < pressAt + 6) {
    return (
      <div style={{ height: '100%', background: C.coral, padding: '110px 28px 0', color: C.ink }}>
        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.12em', opacity: 0.7 }}>CHECKED ON THIS PHONE</div>
        <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 28 }}>Do not admit</div>
        <div style={{ marginTop: 18, background: 'rgba(22,24,28,0.08)', borderRadius: 22, padding: 20, fontSize: 19, fontWeight: 700 }}>No such code</div>
        <Btn tone="ink" pressAt={pressAt} style={{ marginTop: 26 }}>Admit anyway and flag it</Btn>
      </div>
    );
  }
  return (
    <div style={{ height: '100%', background: '#ffcf6b', padding: '110px 28px 0', color: C.ink }}>
      <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.12em', opacity: 0.7 }}>FLAGGED ENTRY</div>
      <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 24, lineHeight: 1.05 }}>Admitted without a match</div>
      <div style={{ marginTop: 20, background: 'rgba(22,24,28,0.08)', borderRadius: 22, padding: 20, fontSize: 18, fontWeight: 700, lineHeight: 1.5 }}>
        <div>Status: Queued to sync</div>
        <div style={{ fontWeight: 600, opacity: 0.8 }}>When signal returns this goes to the estate admin to reconcile, with your name on it.</div>
      </div>
    </div>
  );
}

export function LogTab() {
  const rows: [string, string, string][] = [['18:51', CODE, 'synced'], ['18:40', 'R4TN8W', 'queued'], ['18:22', 'H8VZ3C', 'No such code'], ['18:05', 'Q2MWK7', 'flagged']];
  return (
    <div style={gpad(78)}>
      <div style={{ fontSize: 32, fontWeight: 800 }}>This shift</div>
      <div style={{ fontSize: 15, color: C.muted2, fontWeight: 600, marginTop: 4 }}>4 checks on this phone</div>
      <div style={{ marginTop: 14, background: '#3a2d14', color: '#ffcf6b', borderRadius: 16, padding: '12px 14px', fontSize: 14, fontWeight: 700 }}>2 verifications waiting to upload. They sync automatically.</div>
      {rows.map(([t, c, s]) => (
        <div key={c} style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 4px', borderBottom: `1px solid ${C.ink3}`, fontSize: 18, fontWeight: 800 }}>
          <span style={{ color: C.muted2, width: 64 }}>{t}</span>
          <span style={{ flex: 1, letterSpacing: '0.05em' }}>{c}</span>
          <span style={{ color: s === 'synced' ? C.lime : s === 'queued' ? '#ffcf6b' : s === 'flagged' ? '#ffcf6b' : C.coral, fontSize: 15 }}>{s}</span>
        </div>
      ))}
      <Btn style={{ marginTop: 18, background: C.ink3, color: C.white }}>Sync now</Btn>
    </div>
  );
}

export function EndShiftDialog() {
  const p = useIn(4, 15);
  return (
    <div style={{ ...gpad(78), position: 'relative' }}>
      <div style={{ fontSize: 32, fontWeight: 800, opacity: 0.3 }}>Shift</div>
      <div style={{ position: 'absolute', left: 24, right: 24, top: 300, background: C.white, color: C.ink, borderRadius: 26, padding: 24, ...pop(p) }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>End shift?</div>
        <div style={{ fontSize: 16, color: C.muted, fontWeight: 600, marginTop: 8, lineHeight: 1.4 }}>This signs you out and clears the codes held on this phone.</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Btn tone="field" style={{ flex: 1, height: 52, fontSize: 16 }}>Stay on duty</Btn>
          <Btn tone="ink" style={{ flex: 1, height: 52, fontSize: 16 }}>End shift</Btn>
        </div>
      </div>
    </div>
  );
}
