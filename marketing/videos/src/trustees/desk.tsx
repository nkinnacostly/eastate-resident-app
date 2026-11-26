/**
 * The dashboard (app.myestateaccess.com), emails and the house list, for the
 * trustees' film. Page names and labels are the dashboard's own (shell.tsx:
 * Today at the gate, Houses, Residents, Flagged entries, Guards, Codes, Dues,
 * Payments, Audit log, Settings). Figures and names are examples.
 */
import type { CSSProperties, ReactNode } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

import { C, FONT, Icon, KeyGlyph, rise, useIn } from '../kit';
import { CODE, ESTATE, ESTATE_CODE, GUARD, HOUSE, HOUSE_CODE, RESIDENT } from './screens';

const NAV = ['Today at the gate', 'Houses', 'Residents', 'Flagged entries', 'Guards', 'Codes', 'Dues', 'Payments', 'Audit log', 'Settings'];

/** Browser window holding a dashboard page. */
export function Desk({ active, children, url = 'app.myestateaccess.com', width = 1100, height = 720, delay = 0, nav = true }: { active?: string; children: ReactNode; url?: string; width?: number; height?: number; delay?: number; nav?: boolean }) {
  const p = useIn(delay, 18);
  return (
    <div style={{ width, height, borderRadius: 26, overflow: 'hidden', background: C.white, boxShadow: '0 40px 80px rgba(0,0,0,0.45)', fontFamily: FONT, color: C.ink, display: 'flex', flexDirection: 'column', ...rise(p, 50) }}>
      <div style={{ height: 52, background: C.field, display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px', flexShrink: 0 }}>
        {[C.coral, '#ffcf6b', C.lime].map((c) => <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}
        <div style={{ flex: 1, marginLeft: 12, height: 34, borderRadius: 17, background: C.white, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', fontSize: 17, fontWeight: 600, color: C.muted }}>
          <Icon name="lock" size={15} color={C.muted} />{url}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {nav ? <Sidebar active={active} /> : null}
        <div style={{ flex: 1, padding: '26px 30px', overflow: 'hidden', position: 'relative' }}>{children}</div>
      </div>
    </div>
  );
}

function Sidebar({ active }: { active?: string }) {
  return (
    <div style={{ width: 220, background: C.ink, padding: '22px 14px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px 18px' }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><KeyGlyph size={20} /></div>
        <span style={{ color: C.white, fontWeight: 800, fontSize: 15 }}>myestateaccess</span>
      </div>
      {NAV.map((it) => (
        <div key={it} style={{ padding: '9px 12px', borderRadius: 12, fontSize: 15, fontWeight: 600, background: it === active ? C.ink2 : 'transparent', color: it === active ? C.white : C.muted2 }}>{it}</div>
      ))}
    </div>
  );
}

export const H1 = ({ children, sub }: { children: ReactNode; sub?: ReactNode }) => (
  <div style={{ marginBottom: 16 }}>
    <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>{children}</div>
    {sub ? <div style={{ fontSize: 15, color: C.muted, fontWeight: 600, marginTop: 4 }}>{sub}</div> : null}
  </div>
);

const lbl: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: C.muted };

function Input({ label, value, w, typeFrom, typeTo, select = false }: { label: string; value: string; w?: number | string; typeFrom?: number; typeTo?: number; select?: boolean }) {
  const frame = useCurrentFrame();
  const n = typeFrom === undefined ? value.length : Math.floor(interpolate(frame, [typeFrom, typeTo ?? typeFrom + 24], [0, value.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const typing = typeFrom !== undefined && n > 0 && n < value.length;
  return (
    <div style={{ width: w ?? '100%' }}>
      <div style={lbl}>{label}</div>
      <div style={{ marginTop: 6, height: 44, borderRadius: 13, background: C.field, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', fontSize: 16, fontWeight: 600, boxShadow: typing ? `0 0 0 2px ${C.lime}` : 'none' }}>
        <span>{value.slice(0, n)}{typing ? <span style={{ display: 'inline-block', width: 2, height: 18, background: C.ink, marginLeft: 1, verticalAlign: 'middle' }} /> : null}</span>
        {select ? <span style={{ color: C.muted }}>▾</span> : null}
      </div>
    </div>
  );
}

export function DBtn({ children, tone = 'lime', pressAt, style }: { children: ReactNode; tone?: 'lime' | 'quiet' | 'dark'; pressAt?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const pressed = pressAt !== undefined && frame >= pressAt && frame < pressAt + 8;
  const t = { lime: [C.lime, C.ink], quiet: [C.field, C.muted], dark: [C.ink, C.white] }[tone];
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', height: 40, padding: '0 18px', borderRadius: 13, background: t[0], color: t[1], fontSize: 15, fontWeight: 800, transform: `scale(${pressed ? 0.94 : 1})`, boxShadow: pressed ? `0 0 0 3px ${C.lime}` : 'none', ...style }}>{children}</div>
  );
}

export function Chip({ children, tone = 'good' }: { children: ReactNode; tone?: 'good' | 'bad' | 'plain' | 'warn' }) {
  const t = { good: [C.limeSoft, C.limeInk], bad: [C.coralSoft, C.coralInk], plain: [C.field, C.muted], warn: ['#fff1cc', '#7a5a12'] }[tone];
  return <span style={{ display: 'inline-block', padding: '5px 12px', borderRadius: 999, background: t[0], color: t[1], fontSize: 13, fontWeight: 800 }}>{children}</span>;
}

function TRow({ cells, widths, delay = 0, bold = false, head = false }: { cells: ReactNode[]; widths: (number | string)[]; delay?: number; bold?: boolean; head?: boolean }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: head ? '8px 0' : '12px 0', borderTop: head ? 'none' : `1px solid ${C.line}`, fontSize: head ? 11 : 15, fontWeight: head ? 800 : bold ? 700 : 600, letterSpacing: head ? '0.1em' : 0, color: head ? C.muted : C.ink, ...(head ? {} : rise(p, 12)) }}>
      {cells.map((c, i) => <div key={i} style={{ width: widths[i], flex: widths[i] === 'flex' ? 1 : undefined, flexShrink: 0 }}>{c}</div>)}
    </div>
  );
}

function Stat({ label, value, bad, delay }: { label: string; value: string; bad?: boolean; delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ flex: 1, background: C.canvas, borderRadius: 16, padding: '14px 16px', ...rise(p, 16) }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.muted }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, marginTop: 2, color: bad ? C.coralInk : C.ink }}>{value}</div>
    </div>
  );
}

// ─── Pages ───────────────────────────────────────────────────────────────────

export function SignInPage({ from = 10 }: { from?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ width: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><KeyGlyph size={26} /></div>
          <span style={{ fontWeight: 800, fontSize: 20 }}>myestateaccess</span>
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, marginTop: 26 }}>Sign in</div>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label="EMAIL" value="manager@silveroaks.co.za" typeFrom={from} typeTo={from + 26} />
          <Input label="PASSWORD" value="••••••••••" typeFrom={from + 28} typeTo={from + 40} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.muted }}>Forgot password?</span>
          <DBtn pressAt={from + 50}>Sign in</DBtn>
        </div>
      </div>
    </div>
  );
}

export function OverviewPage({ delay = 0 }: { delay?: number }) {
  const rows: [string, string, string, boolean, string?][] = [
    ['08:41', 'K7Q2MX', `${RESIDENT} · House ${HOUSE}`, true],
    ['08:37', 'R4TN8W', 'Delivery · House 1008', true],
    ['08:22', 'H8VZ3C', 'No such code', false],
    ['08:05', 'Q2MWK7', 'Pieter Botha · House 1044', true],
    ['07:48', 'T9PLD4', 'Already used', false],
  ];
  return (
    <Desk active="Today at the gate">
      <H1 sub={ESTATE}>Welcome back, Jaco</H1>
      <div style={{ display: 'flex', gap: 12 }}>
        <Stat label="ADMITTED TODAY" value="46" delay={delay + 6} />
        <Stat label="REFUSED TODAY" value="3" bad delay={delay + 10} />
        <Stat label="LIVE CODES" value="112" delay={delay + 14} />
        <Stat label="AWAITING APPROVAL" value="2" bad delay={delay + 18} />
      </div>
      <div style={{ marginTop: 14, background: '#fff1cc', color: '#7a5a12', borderRadius: 12, padding: '10px 14px', fontSize: 14, fontWeight: 700 }}>2 people are waiting to be approved.</div>
      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 16 }}>Last entries</div>
      {rows.map((r, i) => (
        <TRow key={i} delay={delay + 24 + i * 5} widths={[70, 110, 'flex', 110]} cells={[r[0], <b key="c" style={{ letterSpacing: '0.06em' }}>{r[1]}</b>, <span key="w" style={{ color: C.muted }}>{r[2]}</span>, <Chip key="s" tone={r[3] ? 'good' : 'bad'}>{r[3] ? 'Admitted' : 'Refused'}</Chip>]} />
      ))}
    </Desk>
  );
}

/** The house list as the estate keeps it. */
export function Spreadsheet({ delay = 0 }: { delay?: number }) {
  const rows = [
    ['1021', 'P. van der Merwe', '+27 82 000 0001', 'owner1021@example.com'],
    ['1022', 'N. Dlamini', '+27 73 000 0002', 'owner1022@example.com'],
    ['1023', 'Silver Oaks Trust', '', 'trust@example.com'],
    ['1024', 'R. Naidoo', '+27 83 000 0004', 'owner1024@example.com'],
    ['1025', 'L. Pretorius', '+27 72 000 0005', ''],
  ];
  const p = useIn(delay, 18);
  return (
    <div style={{ width: 1000, background: C.white, borderRadius: 18, overflow: 'hidden', boxShadow: '0 40px 80px rgba(0,0,0,0.45)', color: C.ink, fontFamily: FONT, ...rise(p, 40) }}>
      <div style={{ height: 44, background: '#1d6f42', color: C.white, display: 'flex', alignItems: 'center', padding: '0 18px', fontSize: 16, fontWeight: 800 }}>silver-oaks-houses.csv</div>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 260px 240px 1fr' }}>
        {['Erf', 'Owner name', 'Cell', 'Email'].map((h) => <div key={h} style={{ padding: '12px 14px', background: C.field, fontSize: 16, fontWeight: 800, borderRight: `1px solid ${C.line}` }}>{h}</div>)}
        {rows.flatMap((r, i) => r.map((c, j) => <div key={`${i}${j}`} style={{ padding: '12px 14px', fontSize: 16, fontWeight: 600, borderTop: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}` }}>{c}</div>))}
      </div>
    </div>
  );
}

/** Import preview: columns mapped, nothing created until Import. */
export function ImportPage({ pressAt = 70 }: { pressAt?: number }) {
  const frame = useCurrentFrame();
  const done = frame > pressAt + 10;
  const map = [['Erf', 'HOUSE NUMBER'], ['Owner name', 'LANDLORD NAME'], ['Cell', 'LANDLORD PHONE'], ['Email', 'LANDLORD EMAIL']];
  return (
    <Desk active="Houses">
      <H1 sub="Import / export">Houses</H1>
      {!done ? (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {map.map(([from, to], i) => (
              <MapChip key={from} from={from} to={to} delay={8 + i * 6} />
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <TRow head widths={[120, 220, 'flex']} cells={['HOUSE', 'LANDLORD', 'EMAIL']} />
            {[['1021', 'P. van der Merwe', 'owner1021@example.com'], ['1022', 'N. Dlamini', 'owner1022@example.com'], ['1023', 'Silver Oaks Trust', 'trust@example.com'], ['1024', 'R. Naidoo', 'owner1024@example.com']].map((r, i) => (
              <TRow key={i} delay={30 + i * 4} widths={[120, 220, 'flex']} cells={r} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 18 }}>
            <DBtn pressAt={pressAt}>Import 412 houses</DBtn>
            <span style={{ fontSize: 14, color: C.muted, fontWeight: 600 }}>Nothing is created until you press Import.</span>
          </div>
        </>
      ) : (
        <ImportDone />
      )}
    </Desk>
  );
}

function MapChip({ from, to, delay }: { from: string; to: string; delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 12, background: C.limeSoft, fontSize: 14, fontWeight: 700, opacity: p }}>
      <span>{from}</span><span style={{ color: C.limeInk }}>→</span><span style={{ fontWeight: 800, color: C.limeInk, letterSpacing: '0.06em', fontSize: 12 }}>{to}</span>
    </div>
  );
}

function ImportDone() {
  const rows = [['1021', 'K2P9'], ['1022', 'M7QX'], ['1023', 'B4TW'], ['1024', 'Z9HC']];
  return (
    <div>
      <div style={{ background: C.limeSoft, borderRadius: 16, padding: '16px 18px', fontSize: 18, fontWeight: 800, color: C.limeInk }}>412 houses created. Each has its own house code.</div>
      <div style={{ marginTop: 14 }}>
        <TRow head widths={[160, 'flex']} cells={['HOUSE', 'HOUSE CODE']} />
        {rows.map((r, i) => <TRow key={i} delay={i * 4} widths={[160, 'flex']} cells={[r[0], <b key="c" style={{ letterSpacing: '0.12em' }}>{r[1]}</b>]} />)}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}><DBtn tone="dark">Download these codes</DBtn><DBtn tone="quiet">Export all codes</DBtn></div>
    </div>
  );
}

export function SettingsPage() {
  return (
    <Desk active="Settings">
      <H1>Settings</H1>
      <div style={{ background: C.canvas, borderRadius: 18, padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>Estate code</div>
        <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: '0.12em', marginTop: 6 }}>{ESTATE_CODE}</div>
        <div style={{ fontSize: 14, color: C.muted, fontWeight: 600, marginTop: 6 }}>Residents enter this with their house code to ask to join.</div>
        <DBtn tone="quiet" style={{ marginTop: 14 }}>Rotate</DBtn>
      </div>
      <div style={{ background: C.canvas, borderRadius: 18, padding: 22, marginTop: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>Code rules</div>
        <div style={{ fontSize: 15, color: C.muted, fontWeight: 600, marginTop: 6, lineHeight: 1.5 }}>Six characters · one entry · six hours · three live codes per resident</div>
      </div>
    </Desk>
  );
}

/** Register a guard, then the once-only handover. */
export function GuardsPage({ pressAt = 70 }: { pressAt?: number }) {
  const frame = useCurrentFrame();
  const done = frame > pressAt + 8;
  return (
    <Desk active="Guards">
      <H1 sub="Guards who can verify codes at this estate.">Guards</H1>
      {!done ? (
        <div style={{ background: C.canvas, borderRadius: 18, padding: 20 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Input label="FULL NAME" value={GUARD} typeFrom={6} typeTo={24} />
            <Input label="EMAIL" value="thabo@example.com" typeFrom={26} typeTo={44} />
            <Input label="PHONE" value="+27 71 000 0009" typeFrom={46} typeTo={60} />
          </div>
          <DBtn pressAt={pressAt} style={{ marginTop: 16 }}>Register guard</DBtn>
          <div style={{ fontSize: 13, color: C.muted, fontWeight: 600, marginTop: 10, lineHeight: 1.45 }}>This creates a sign-in for the guard app. If the address already has an account, that person is sent an invitation instead.</div>
        </div>
      ) : (
        <div style={{ background: C.limeSoft, borderRadius: 18, padding: 22 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{GUARD} can now work the gate</div>
          <div style={{ fontSize: 14, color: C.limeInk, fontWeight: 600, marginTop: 4 }}>Shown once. They are also emailed a link to set their own password.</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
            <div style={{ flex: 1, background: C.white, borderRadius: 14, padding: 14 }}><div style={lbl}>EMAIL</div><div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>thabo@example.com</div></div>
            <div style={{ flex: 1, background: C.white, borderRadius: 14, padding: 14 }}><div style={lbl}>PASSWORD</div><div style={{ fontSize: 17, fontWeight: 800, marginTop: 4, letterSpacing: '0.06em' }}>7KQM-2XWP-HD4T-9RNB</div></div>
          </div>
        </div>
      )}
      <div style={{ marginTop: 16, background: C.canvas, borderRadius: 16, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><div style={{ fontSize: 16, fontWeight: 800 }}>Nobody is on duty</div><div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>A guard holds the gate by starting a shift in the guard app.</div></div>
        <Chip tone="plain">Unmanned</Chip>
      </div>
    </Desk>
  );
}

/** Payout account (South Africa) and who pays. */
export function DuesSetupPage({ stage = 'account', at = 0 }: { stage?: 'account' | 'billing'; at?: number }) {
  if (stage === 'account') {
    return (
      <Desk active="Dues">
        <H1 sub="Where the estate's dues are paid out.">Dues</H1>
        <div style={{ background: C.canvas, borderRadius: 18, padding: 20 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Input label="COUNTRY" value="South Africa" select w={210} />
            <Input label="BANK" value="First National Bank" select />
            <Input label="ACCOUNT NUMBER" value="62152854587" typeFrom={at + 8} typeTo={at + 26} />
          </div>
          <DBtn tone="dark" style={{ marginTop: 14 }}>Check account</DBtn>
          <div style={{ marginTop: 14, background: C.white, borderRadius: 14, padding: '12px 14px', fontSize: 14, color: C.muted, fontWeight: 600, lineHeight: 1.45 }}>
            Our payment provider offers no account-name check for South African accounts, so we cannot confirm who owns this account. Type the name exactly as the bank has it, and check the number once more before saving.
          </div>
          <div style={{ marginTop: 12 }}><Input label="BODY CORPORATE NAME AS THE BANK HAS IT" value="Silver Oaks HOA" typeFrom={at + 40} typeTo={at + 58} /></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <DBtn pressAt={at + 70}>Save this account</DBtn>
            <Chip tone="plain">Not verified</Chip>
            <span style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>•••• 4587</span>
          </div>
        </div>
      </Desk>
    );
  }
  return (
    <Desk active="Dues">
      <H1 sub="Who pays the dues">Dues</H1>
      <div style={{ background: C.canvas, borderRadius: 18, padding: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Input label="BILLED TO" value="The landlord / owner of each house" select w={330} />
          <Input label="CURRENCY" value="ZAR" select w={120} />
          <Input label="AMOUNT A MONTH" value="1850" w={170} typeFrom={at + 6} typeTo={at + 16} />
          <Input label="DAYS TO PAY" value="7" w={130} />
        </div>
        <DBtn pressAt={at + 40} style={{ marginTop: 16 }}>Save</DBtn>
        <div style={{ fontSize: 14, color: C.muted, fontWeight: 600, marginTop: 12, lineHeight: 1.45 }}>Bills are raised on the 1st of every month. Saving raises this month&apos;s bills straight away.</div>
      </div>
    </Desk>
  );
}

export function ResidentsPage({ pressAt = 40 }: { pressAt?: number }) {
  const frame = useCurrentFrame();
  const approved = frame > pressAt + 6;
  const reqs: [string, string][] = [[RESIDENT, HOUSE], ['Sipho Ndlovu', '1022'], ['Anika Smit', '1024']];
  return (
    <Desk active="Residents">
      <H1 sub="People asking to join, and everyone approved.">Residents</H1>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{approved ? 'Nobody waiting' : `${reqs.length} waiting for approval`}</div>
        {!approved ? <DBtn pressAt={pressAt}>Approve all {reqs.length}</DBtn> : null}
      </div>
      <div style={{ marginTop: 10 }}>
        {reqs.map(([name, house], i) => (
          <TRow key={name} delay={6 + i * 5} widths={['flex', 180, 160]} cells={[<b key="n">{name}</b>, `House ${house}`, approved ? <Chip key="a">Approved</Chip> : <DBtn key="b" tone="quiet" style={{ height: 32, fontSize: 13 }}>{`Approve for house ${house}`}</DBtn>]} />
        ))}
      </div>
    </Desk>
  );
}

export function CodesPage({ pressAt = 40 }: { pressAt?: number }) {
  const frame = useCurrentFrame();
  const revoked = frame > pressAt + 6;
  return (
    <Desk active="Codes">
      <H1 sub="Revoke any live code. An offline gate phone picks it up at its next sync.">Codes</H1>
      <TRow head widths={[120, 'flex', 120, 120]} cells={['CODE', 'MADE BY', 'STATUS', '']} />
      {[[CODE, `${RESIDENT} · House ${HOUSE}`], ['R4TN8W', 'Sipho Ndlovu · House 1022'], ['P8XZ2D', 'Anika Smit · House 1024']].map(([c, who], i) => (
        <TRow key={c} delay={6 + i * 5} widths={[120, 'flex', 120, 120]} cells={[<b key="c" style={{ letterSpacing: '0.06em' }}>{c}</b>, who, i === 1 && revoked ? <Chip key="s" tone="plain">Revoked</Chip> : <Chip key="s">Live</Chip>, i === 1 && !revoked ? <DBtn key="r" tone="quiet" pressAt={pressAt} style={{ height: 32, fontSize: 13 }}>Revoke</DBtn> : null]} />
      ))}
    </Desk>
  );
}

export function AuditPage() {
  const rows: [string, string, string, string, string][] = [
    ['18:51', 'Admitted', '—', GUARD, `${RESIDENT} · ${HOUSE}`],
    ['18:22', 'Refused', 'No such code', GUARD, '—'],
    ['18:05', 'Flagged', 'Admitted without a match', GUARD, '—'],
    ['17:40', 'Refused', 'Expired', GUARD, '—'],
    ['17:12', 'Admitted', '—', GUARD, 'Pieter Botha · 1044'],
  ];
  return (
    <Desk active="Audit log">
      <H1 sub="Records are append-only — nothing here can be edited or deleted.">Audit log</H1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>{['All', 'Admitted', 'Refused', 'Flagged'].map((f, i) => <span key={f} style={{ padding: '6px 14px', borderRadius: 999, background: i === 0 ? C.ink : C.field, color: i === 0 ? C.white : C.muted, fontSize: 13, fontWeight: 800 }}>{f}</span>)}</div>
      <TRow head widths={[70, 110, 'flex', 170, 190]} cells={['TIME', 'OUTCOME', 'REASON', 'GUARD', 'HOST']} />
      {rows.map((r, i) => (
        <TRow key={i} delay={6 + i * 5} widths={[70, 110, 'flex', 170, 190]} cells={[r[0], <Chip key="o" tone={r[1] === 'Admitted' ? 'good' : r[1] === 'Flagged' ? 'warn' : 'bad'}>{r[1]}</Chip>, r[2], r[3], r[4]]} />
      ))}
    </Desk>
  );
}

export function GuardProfilePage({ pressAt = 50 }: { pressAt?: number }) {
  const frame = useCurrentFrame();
  const removed = frame > pressAt + 30;
  return (
    <Desk active="Guards">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><div style={{ fontSize: 26, fontWeight: 800 }}>{GUARD}</div><div style={{ fontSize: 14, color: C.muted, fontWeight: 600 }}>Guard since 1 Dec 2026 · placed by Gatekeepers Security</div></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {removed ? <Chip tone="plain">Removed</Chip> : <><Chip>On duty</Chip><DBtn tone="quiet" pressAt={pressAt}>Remove from the gate</DBtn></>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <Stat label="VERIFIED · 30D" value="1 284" delay={4} />
        <Stat label="REFUSED" value="37" delay={7} />
        <Stat label="FLAGGED" value="2" bad delay={10} />
        <Stat label="HOURS ON DUTY" value="212" delay={13} />
      </div>
      <div style={{ marginTop: 14, background: C.canvas, borderRadius: 16, padding: 16, display: 'flex', gap: 30 }}>
        <div><div style={lbl}>LICENCE NUMBER</div><div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>PSIRA 3480112</div></div>
        <div><div style={lbl}>EXPIRES</div><div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>30 Jun 2027</div></div>
        <div><div style={lbl}>AGENCY</div><div style={{ fontSize: 17, fontWeight: 800, marginTop: 4 }}>Gatekeepers Security</div></div>
      </div>
      {frame > pressAt && !removed ? (
        <div style={{ position: 'absolute', left: 60, right: 60, top: 150, background: C.white, borderRadius: 18, padding: 20, boxShadow: '0 30px 60px rgba(0,0,0,0.3)', fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>
          <b>Remove {GUARD} from {ESTATE}?</b><br />They can no longer check codes here, and their phone clears its codes the next time it checks in. Their shifts and every check they made stay on record.
        </div>
      ) : null}
    </Desk>
  );
}

export function PaymentsPage() {
  const rows: [string, string, string, string, string, string][] = [
    ['1 Dec', 'owner1021@example.com', 'Card', 'Dec 2026 – Nov 2027', 'R 22 200', 'Successful'],
    ['2 Dec', 'owner1022@example.com', 'Card', 'Dec 2026', 'R 1 850', 'Successful'],
    ['3 Dec', 'owner1024@example.com', 'Card', 'Dec 2026', 'R 1 850', 'Failed'],
  ];
  return (
    <Desk active="Payments">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <H1 sub="Every payment, and every failed attempt.">Payments</H1>
        <DBtn tone="dark">Export CSV</DBtn>
      </div>
      <TRow head widths={[70, 'flex', 70, 200, 110, 110]} cells={['DATE', 'PAID BY', 'HOW', 'MONTHS', 'AMOUNT', 'STATUS']} />
      {rows.map((r, i) => (
        <TRow key={i} delay={6 + i * 5} widths={[70, 'flex', 70, 200, 110, 110]} cells={[r[0], r[1], r[2], r[3], <b key="a">{r[4]}</b>, <Chip key="s" tone={r[5] === 'Successful' ? 'good' : 'bad'}>{r[5]}</Chip>]} />
      ))}
      <div style={{ marginTop: 14, background: C.canvas, borderRadius: 14, padding: '12px 16px', fontSize: 14, color: C.muted, fontWeight: 600 }}>Each payment shows the amount charged, Flutterwave&apos;s fee and the amount paid out to the HOA.</div>
    </Desk>
  );
}

// ─── Email ───────────────────────────────────────────────────────────────────

export function Email({ subject, to, children, delay = 0, width = 900 }: { subject: string; to: string; children: ReactNode; delay?: number; width?: number }) {
  const p = useIn(delay, 18);
  return (
    <div style={{ width, background: C.white, borderRadius: 22, overflow: 'hidden', boxShadow: '0 40px 80px rgba(0,0,0,0.45)', color: C.ink, fontFamily: FONT, ...rise(p, 40) }}>
      <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{subject}</div>
        <div style={{ fontSize: 14, color: C.muted, fontWeight: 600, marginTop: 4 }}>myestateaccess &lt;no-reply@myestateaccess.com&gt; → {to}</div>
      </div>
      <div style={{ padding: '22px 24px', fontSize: 17, lineHeight: 1.55, fontWeight: 500 }}>{children}</div>
    </div>
  );
}

export const MailBtn = ({ children }: { children: ReactNode }) => (
  <div style={{ display: 'inline-block', marginTop: 14, padding: '12px 22px', borderRadius: 14, background: C.lime, fontWeight: 800 }}>{children}</div>
);

export function HouseCodeEmail({ delay = 0 }: { delay?: number }) {
  return (
    <Email subject={`House ${HOUSE} at ${ESTATE} — your house code`} to="owner1021@example.com" delay={delay}>
      Your house code is <b style={{ fontSize: 26, letterSpacing: '0.1em' }}>{HOUSE_CODE}</b>. Give it to the people living in the house: with the estate code, it lets them ask to join in the My Estate Access app.
    </Email>
  );
}
