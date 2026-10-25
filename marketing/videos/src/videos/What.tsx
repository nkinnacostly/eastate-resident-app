/** 2 of 5 — WHAT is it? Two apps, one website, one rule for every code. */
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { C, Frame, Icon, IconTile, Kicker, Note, Pill, Title, rise, useFormat, useIn } from '../kit';
import { CodeScreen, DuesScreen, GuardCheck, Phone, ShareSheet, Verdict } from '../phone';
import { Above, Beside, Copy, Outro, Scene, Statement, Video, WIntro } from '../scenes';
import { AuditLog, Browser } from '../web';

function Piece({ icon, name, who, does, delay }: { icon: string; name: string; who: string; does: string; delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ display: 'flex', gap: 26, alignItems: 'center', background: C.ink2, borderRadius: 34, padding: '28px 30px', ...rise(p, 50) }}>
      <IconTile name={icon} size={96} delay={delay} />
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '0.14em', color: C.lime }}>{who.toUpperCase()}</div>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4 }}>{name}</div>
        <div style={{ fontSize: 26, fontWeight: 500, color: 'rgba(255,255,255,0.72)', marginTop: 6 }}>{does}</div>
      </div>
    </div>
  );
}

function ThreePieces() {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center', gap: 22 }}>
        <Title text="Three pieces. One system." size={84} highlight={['One']} style={{ marginBottom: 22 }} />
        <Piece icon="phone" who="For residents" name="My Estate Access" does="Create visitor codes. Pay dues." delay={18} />
        <Piece icon="shield" who="For the gate" name="My Estate Access Guard" does="Check codes — even with no signal." delay={30} />
        <Piece icon="globe" who="For the estate office" name="app.myestateaccess.com" does="Houses, residents, guards, dues, records." delay={42} />
      </Frame>
    </Scene>
  );
}

function TheCode() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const code = 'K7Q2MX';
  const noteIn = useIn(104);
  const { contentW } = useFormat();
  const cardW = Math.min(138, Math.floor((contentW - 70) / 6));
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <Kicker delay={2}>The heart of it</Kicker>
        <Title text="A code that lets one person in." size={76} delay={6} style={{ marginTop: 18 }} />
        <div style={{ display: 'flex', gap: 14, marginTop: 50 }}>
          {code.split('').map((ch, i) => {
            const p = spring({ frame: frame - 26 - i * 5, fps, config: { damping: 11, mass: 0.8, stiffness: 140 } });
            return (
              <div key={i} style={{ width: cardW, height: 170, borderRadius: 32, background: C.white, color: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 104, fontWeight: 800, transform: `translateY(${(1 - p) * -90}px) rotate(${(1 - p) * (i % 2 ? 8 : -8)}deg) scale(${0.7 + 0.3 * Math.min(1, p)})`, opacity: Math.min(1, p * 1.6) }}>
                {ch}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 50 }}>
          <Pill delay={70}>6 characters</Pill>
          <Pill delay={78}>One entry</Pill>
          <Pill delay={86}>Dies after 6 hours</Pill>
          <Pill delay={94} tone="dark">3 live per resident</Pill>
        </div>
        <div style={{ marginTop: 34, fontSize: 28, color: 'rgba(255,255,255,0.7)', fontWeight: 600, ...rise(noteIn, 20) }}>No O or 0, no I or 1 — nothing to misread at the gate.</div>
      </Frame>
    </Scene>
  );
}

function Step({ n, text, active, done }: { n: number; text: string; active: boolean; done: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', padding: '16px 0', opacity: active || done ? 1 : 0.4 }}>
      <div style={{ width: 54, height: 54, borderRadius: 27, background: active ? C.lime : done ? C.ink3 : 'transparent', border: `2px solid ${active ? C.lime : C.ink3}`, color: active ? C.ink : C.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800, flexShrink: 0 }}>
        {done && !active ? <Icon name="check" size={28} color={C.lime} width={2.6} /> : n}
      </div>
      <div style={{ fontSize: 31, fontWeight: 700, lineHeight: 1.25 }}>{text}</div>
    </div>
  );
}

function AVisit() {
  const frame = useCurrentFrame();
  const stage = frame < 70 ? 0 : frame < 130 ? 1 : frame < 250 ? 2 : 3;
  const steps = ['Resident creates a code', 'Sends it by WhatsApp, SMS or email', 'Visitor gives it at the gate', 'Guard checks it — and the resident is told'];
  return (
    <Beside
      leftWidth={500}
      left={
        <div>
          <Kicker delay={2}>A visit, start to finish</Kicker>
          <div style={{ marginTop: 20 }}>
            {steps.map((s, i) => (
              <Step key={s} n={i + 1} text={s} active={i === stage} done={i < stage} />
            ))}
          </div>
        </div>
      }
      right={
        <Phone scale={0.84} delay={4}>
          {frame < 130 ? (
            <>
              <CodeScreen landAt={6} />
              <ShareSheet at={70} pick={0} />
            </>
          ) : frame < 250 ? (
            <GuardCheck from={150} to={230} />
          ) : (
            <Verdict ok at={252} />
          )}
        </Phone>
      }
    />
  );
}

function Refusals() {
  const frame = useCurrentFrame();
  const reasons = ['No such code', 'Expired', 'Already used', 'Cancelled by the estate'];
  const idx = Math.min(reasons.length - 1, Math.floor(Math.max(0, frame - 30) / 48));
  const { vertical } = useFormat();
  return (
    <Beside
      stack={0.86}
      left={
        <div>
          <Copy icon="x" kicker="When it's wrong" title="Never just “no”." body="The guard is told why — in words they can read out to the visitor." />
          <div style={{ display: 'flex', flexDirection: vertical ? 'row' : 'column', flexWrap: 'wrap', gap: 12, marginTop: 30, alignItems: 'flex-start' }}>
            {reasons.map((r, i) => (
              <div key={r} style={{ padding: '12px 22px', borderRadius: 999, fontSize: 26, fontWeight: 800, background: i === idx ? C.coralSoft : C.ink2, color: i === idx ? C.coralInk : C.muted2 }}>
                {r}
              </div>
            ))}
          </div>
        </div>
      }
      right={<Phone scale={0.84} delay={6}><Verdict ok={false} reason={reasons[idx]} at={10} /></Phone>}
    />
  );
}

function Offline() {
  return (
    <Beside
      left={<Copy icon="wifiOff" kicker="No signal?" title="The gate keeps working." body="The guard's phone checks codes on its own for up to six hours — and catches up the moment signal returns." />}
      right={<Phone scale={0.84} delay={6}><GuardCheck offline from={40} to={120} /></Phone>}
    />
  );
}

function Record() {
  return (
    <Above
      top={<Copy icon="list" kicker="The record" title="Every check is kept — refusals too." size={66} body="Written as it happens. Nothing in it can be edited or deleted." />}
      bottom={
        <Browser width={936} height={560} delay={16}>
          <AuditLog delay={18} />
        </Browser>
      }
    />
  );
}

function Dues() {
  return (
    <Beside
      left={<Copy icon="money" kicker="Built in" title="Estate dues, collected for you." body="Bills raised on the 1st. Email reminders. Pay monthly — or up to a year ahead." />}
      right={<Phone scale={0.84} delay={6}><DuesScreen pickAt={110} /></Phone>}
    />
  );
}

function Meaning() {
  return (
    <Statement
      kicker="In one line"
      text="A visitor-access and dues system for residential estates."
      highlight={['visitor-access', 'dues']}
      sub="Two phone apps. One website. One record of everything."
    />
  );
}

export function What() {
  return (
    <Video
      series="What"
      scenes={[
        { sec: 6, el: <WIntro word="WHAT" question="is My Estate Access?" index={2} /> },
        { sec: 7, el: <Meaning /> },
        { sec: 12, el: <ThreePieces />, enter: 'slide' },
        { sec: 11, el: <TheCode />, enter: 'slide' },
        { sec: 16, el: <AVisit />, enter: 'slide' },
        { sec: 9, el: <Refusals />, enter: 'slide' },
        { sec: 8, el: <Offline />, enter: 'slide' },
        { sec: 8, el: <Record />, enter: 'slide' },
        { sec: 9, el: <Dues />, enter: 'slide' },
        { sec: 14, el: <><Outro next="Why" /><Note delay={20}>Screens are simplified. Names and codes are examples.</Note></> },
      ]}
    />
  );
}

