/**
 * Browser-window recreations of the dashboard at app.myestateaccess.com.
 * Figures and names on them are examples.
 */
import type { CSSProperties, ReactNode } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import { C, FONT, Icon, KeyGlyph, rise, useFormat, useIn } from './kit';

/** Browser chrome with a URL bar that can type itself out. */
export function Browser({ url = 'app.myestateaccess.com', typeFrom, typeTo, children, width = 936, height = 760, delay = 0, style }: { url?: string; typeFrom?: number; typeTo?: number; children: ReactNode; width?: number; height?: number; delay?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const p = useIn(delay, 18);
  const { contentW } = useFormat();
  const n = typeFrom === undefined ? url.length : Math.floor(interpolate(frame, [typeFrom, typeTo ?? typeFrom + 30], [0, url.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  return (
    <div style={{ width: Math.min(width, contentW), height, borderRadius: 30, overflow: 'hidden', background: C.white, boxShadow: '0 40px 80px rgba(0,0,0,0.4)', fontFamily: FONT, color: C.ink, display: 'flex', flexDirection: 'column', ...rise(p, 60), ...style }}>
      <div style={{ height: 64, background: C.field, display: 'flex', alignItems: 'center', gap: 10, padding: '0 22px', flexShrink: 0 }}>
        {[C.coral, '#ffcf6b', C.lime].map((c) => (
          <div key={c} style={{ width: 15, height: 15, borderRadius: 8, background: c }} />
        ))}
        <div style={{ flex: 1, marginLeft: 14, height: 40, borderRadius: 20, background: C.white, display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px', fontSize: 20, fontWeight: 600, color: C.muted }}>
          <Icon name="lock" size={18} color={C.muted} />
          {url.slice(0, n)}
          {typeFrom !== undefined && n < url.length ? <span style={{ width: 2, height: 22, background: C.ink }} /> : null}
        </div>
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function Sidebar({ active }: { active: string }) {
  const items = ['Overview', 'Houses', 'Residents', 'Guards', 'Codes', 'Dues', 'Payments', 'Audit log'];
  return (
    <div style={{ width: 230, background: C.ink, height: '100%', padding: '26px 16px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 24px' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <KeyGlyph size={22} />
        </div>
        <span style={{ color: C.white, fontWeight: 800, fontSize: 16 }}>myestateaccess</span>
      </div>
      {items.map((it) => (
        <div key={it} style={{ padding: '11px 14px', borderRadius: 14, fontSize: 17, fontWeight: 600, background: it === active ? C.ink2 : 'transparent', color: it === active ? C.white : C.muted2 }}>
          {it}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, bad, delay }: { label: string; value: string; bad?: boolean; delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ flex: 1, background: C.canvas, borderRadius: 20, padding: '16px 18px', ...rise(p, 20) }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: C.muted }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 800, marginTop: 4, color: bad ? C.coralInk : C.ink }}>{value}</div>
    </div>
  );
}

export type Row = { time: string; code: string; who: string; ok: boolean; label?: string };

export function EntryRows({ rows, delay = 0, step = 6 }: { rows: Row[]; delay?: number; step?: number }) {
  return (
    <div>
      {rows.map((r, i) => (
        <EntryRow key={i} r={r} delay={delay + i * step} />
      ))}
    </div>
  );
}

function EntryRow({ r, delay }: { r: Row; delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '15px 0', borderTop: `1px solid ${C.line}`, fontSize: 18, ...rise(p, 16) }}>
      <span style={{ width: 64, color: C.muted, fontWeight: 600 }}>{r.time}</span>
      <span style={{ width: 110, fontWeight: 800, letterSpacing: '0.06em' }}>{r.code}</span>
      <span style={{ flex: 1, color: C.muted, fontWeight: 600 }}>{r.who}</span>
      <span style={{ padding: '6px 14px', borderRadius: 999, fontSize: 14, fontWeight: 800, background: r.ok ? C.limeSoft : C.coralSoft, color: r.ok ? C.limeInk : C.coralInk }}>
        {r.label ?? (r.ok ? 'Admitted' : 'Refused')}
      </span>
    </div>
  );
}

export const SAMPLE_ROWS: Row[] = [
  { time: '08:41', code: 'K7Q2MX', who: 'Host: Ada O. · House 12', ok: true },
  { time: '08:37', code: 'R4TN8W', who: 'Delivery · House 3', ok: true },
  { time: '08:22', code: 'H8VZ3C', who: 'No such code', ok: false },
  { time: '08:05', code: 'Q2MWK7', who: 'Host: Bo B. · House 7', ok: true },
  { time: '07:48', code: 'T9PLD4', who: 'Already used', ok: false },
];

/** The dashboard's opening page. */
export function Dashboard({ delay = 0 }: { delay?: number }) {
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <Sidebar active="Overview" />
      <div style={{ flex: 1, padding: '28px 30px' }}>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>Today at the gate</div>
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <Stat label="ADMITTED" value="46" delay={delay + 6} />
          <Stat label="REFUSED" value="3" bad delay={delay + 10} />
          <Stat label="LIVE CODES" value="112" delay={delay + 14} />
          <Stat label="TO APPROVE" value="2" bad delay={delay + 18} />
        </div>
        <div style={{ marginTop: 22 }}>
          <EntryRows rows={SAMPLE_ROWS} delay={delay + 24} />
        </div>
      </div>
    </div>
  );
}

/** The audit log: every check, refusals included, append-only. */
export function AuditLog({ delay = 0 }: { delay?: number }) {
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <Sidebar active="Audit log" />
      <div style={{ flex: 1, padding: '28px 30px' }}>
        <div style={{ fontSize: 30, fontWeight: 800 }}>Audit log</div>
        <div style={{ fontSize: 16, color: C.muted, marginTop: 4, fontWeight: 600 }}>Append-only — nothing here can be edited or deleted.</div>
        <div style={{ marginTop: 18 }}>
          <EntryRows rows={SAMPLE_ROWS.concat([{ time: '07:30', code: 'D3CV7H', who: 'Host: Cy C. · House 4', ok: true }])} delay={delay + 8} />
        </div>
      </div>
    </div>
  );
}

/** The landlord's portal: all their houses, whatever the estate. */
export function LandlordView({ delay = 0 }: { delay?: number }) {
  const houses = [
    ['PALM COURT', 'House 12', 'Clear', true],
    ['PALM COURT', 'House 3', 'Due', false],
    ['CEDAR VIEW', 'House 7', 'Clear', true],
  ] as const;
  return (
    <div style={{ padding: '28px 34px', background: C.canvas, height: '100%' }}>
      <div style={{ fontSize: 30, fontWeight: 800 }}>Your properties</div>
      <div style={{ fontSize: 16, color: C.muted, fontWeight: 600, marginTop: 4 }}>Every house you own, across estates.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 22 }}>
        {houses.map(([estate, house, chip, clear], i) => (
          <LandlordCard key={house + estate} estate={estate} house={house} chip={chip} clear={clear} delay={delay + 8 + i * 6} />
        ))}
        <LandlordPay delay={delay + 26} />
      </div>
    </div>
  );
}

function LandlordCard({ estate, house, chip, clear, delay }: { estate: string; house: string; chip: string; clear: boolean; delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ background: C.white, borderRadius: 24, padding: 22, ...rise(p, 20) }}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: C.muted }}>{estate}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span style={{ fontSize: 26, fontWeight: 800 }}>{house}</span>
        <span style={{ padding: '6px 14px', borderRadius: 999, fontSize: 14, fontWeight: 800, background: clear ? C.limeSoft : C.field, color: clear ? C.limeInk : C.muted }}>{chip}</span>
      </div>
    </div>
  );
}

function LandlordPay({ delay }: { delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ background: C.ink, color: C.white, borderRadius: 24, padding: 22, ...rise(p, 20) }}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: C.lime }}>HOUSE 3 · PAY FOR</div>
      <div style={{ fontSize: 24, fontWeight: 800, marginTop: 8 }}>Yearly · ₦300,000</div>
    </div>
  );
}

/** What a security company sees: totals, never people. */
export function AgencyCounts({ delay = 0 }: { delay?: number }) {
  const rows = [
    ['Shifts', '62'],
    ['Hours on duty', '744'],
    ['Admitted', '1,204'],
    ['Refused', '38'],
  ];
  return (
    <div style={{ padding: '28px 34px', height: '100%' }}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.08em', color: C.muted }}>SECURITY COMPANY · LAST 30 DAYS</div>
      <div style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>Palm Court</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 20 }}>
        {rows.map(([k, v], i) => (
          <Stat key={k} label={k.toUpperCase()} value={v} delay={delay + 8 + i * 5} />
        ))}
      </div>
      <div style={{ marginTop: 20, padding: '16px 20px', borderRadius: 18, background: C.limeSoft, color: C.limeInk, fontSize: 17, fontWeight: 700 }}>
        Counts only — no residents, no visitors, no codes.
      </div>
    </div>
  );
}
