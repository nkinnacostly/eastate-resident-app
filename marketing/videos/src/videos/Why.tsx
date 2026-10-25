/** 3 of 5 — WHY do estates need it? The gate today, and what changes. */
import { interpolate, useCurrentFrame } from 'remotion';

import { C, Frame, Icon, Kicker, Title, pop, rise, useIn } from '../kit';
import { DuesScreen, GuardCheck, Phone } from '../phone';
import { Above, Beside, Copy, Outro, Scene, Statement, Video, WIntro } from '../scenes';
import { AuditLog, Browser } from '../web';

function Problem({ text, delay }: { text: string; delay: number }) {
  const p = useIn(delay, 16);
  const strike = useIn(delay + 22, 20);
  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'center', background: C.ink2, borderRadius: 28, padding: '24px 28px', ...rise(p, 40) }}>
      <div style={{ width: 62, height: 62, borderRadius: 31, background: C.coralSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...pop(strike) }}>
        <Icon name="x" size={34} color={C.coralInk} width={2.6} />
      </div>
      <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.25 }}>{text}</div>
    </div>
  );
}

function TheGateToday() {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center', gap: 18 }}>
        <Kicker delay={2}>The gate today</Kicker>
        <Title text="Trust, phone calls and a notebook." size={80} delay={6} style={{ marginBottom: 24 }} />
        <Problem text="A visitor gives any name they like." delay={34} />
        <Problem text="The guard phones a resident who doesn't pick up." delay={70} />
        <Problem text="A visitor book nobody can search." delay={106} />
        <Problem text="Standing passes that never expire." delay={142} />
      </Frame>
    </Scene>
  );
}

function Invitation() {
  const frame = useCurrentFrame();
  const stamp = interpolate(frame, [90, 102], [2.4, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const stampOn = frame >= 90;
  const codeIn = useIn(40);
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <Copy icon="shield" kicker="Safer" title="Visitors come in on a resident's invitation." size={70} body="Not a name given at the gate. One code, one person, once — and it dies after six hours." />
        <div style={{ position: 'relative', marginTop: 50, alignSelf: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 12, ...rise(codeIn, 30) }}>
            {'K7Q2MX'.split('').map((ch, i) => (
              <div key={i} style={{ width: 106, height: 130, borderRadius: 26, background: C.white, color: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 78, fontWeight: 800 }}>
                {ch}
              </div>
            ))}
          </div>
          {stampOn ? (
            <div style={{ position: 'absolute', top: 26, left: 110, padding: '14px 28px', border: `6px solid ${C.coral}`, borderRadius: 18, color: C.coral, fontSize: 52, fontWeight: 800, letterSpacing: '0.08em', background: 'rgba(22,24,28,0.82)', transform: `rotate(-10deg) scale(${stamp})` }}>
              ALREADY USED
            </div>
          ) : null}
        </div>
      </Frame>
    </Scene>
  );
}

function Accountable() {
  return (
    <Above
      top={<Copy icon="list" kicker="Accountable" title="Who came in, when — and who let them in." size={66} />}
      bottom={
        <Browser width={936} height={600} delay={14}>
          <AuditLog delay={16} />
        </Browser>
      }
    />
  );
}

function Reliable() {
  return (
    <Beside
      left={<Copy icon="wifiOff" kicker="Reliable" title="A network outage never closes the gate." body="The guard's phone keeps checking codes on its own, then catches up when signal returns." />}
      right={<Phone scale={0.84} delay={6}><GuardCheck offline from={40} to={120} /></Phone>}
    />
  );
}

function Fast() {
  const frame = useCurrentFrame();
  const secs = Math.round(interpolate(frame, [30, 150], [0, 20], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const p = useIn(24, 14);
  const lineIn = useIn(60);
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <Copy icon="clock" kicker="Fast" title="Seconds, not phone calls." size={84} />
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 50, ...pop(p) }}>
          <span style={{ fontSize: 230, fontWeight: 800, letterSpacing: '-0.05em', color: C.lime, lineHeight: 1 }}>{`0:${String(secs).padStart(2, '0')}`}</span>
        </div>
        <div style={{ fontSize: 36, fontWeight: 600, color: 'rgba(255,255,255,0.78)', marginTop: 20, ...rise(lineIn, 20) }}>
          About twenty seconds to create a code and send it. Nobody waits at the barrier.
        </div>
      </Frame>
    </Scene>
  );
}

function Money() {
  return (
    <Beside
      left={<Copy icon="money" kicker="Dues that come in" title="Easy to pay. Hard to forget." body="Email reminders 7 days and 2 days before each due date. Pay a year ahead. Paid straight into the estate's account." />}
      right={<Phone scale={0.84} delay={6}><DuesScreen pickAt={120} /></Phone>}
    />
  );
}

function Num({ n, label, delay }: { n: string; label: string; delay: number }) {
  const p = useIn(delay, 13);
  return (
    <div style={{ background: C.ink2, borderRadius: 34, padding: '34px 32px', ...pop(p) }}>
      <div style={{ fontSize: 150, fontWeight: 800, color: C.lime, letterSpacing: '-0.05em', lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 14, color: 'rgba(255,255,255,0.8)' }}>{label}</div>
    </div>
  );
}

function Numbers() {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <Title text="The rules, in four numbers." size={80} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 44 }}>
          <Num n="6h" label="Code lifetime, then it stops working" delay={20} />
          <Num n="1" label="Use per code" delay={28} />
          <Num n="3" label="Live codes per resident" delay={36} />
          <Num n="0" label="Signal needed at the gate" delay={44} />
        </div>
      </Frame>
    </Scene>
  );
}

export function Why() {
  return (
    <Video
      series="Why"
      scenes={[
        { sec: 6, el: <WIntro word="WHY" question="do estates need it?" index={3} /> },
        { sec: 15, el: <TheGateToday /> },
        { sec: 7, el: <Statement kicker="And dues?" text="Transfers matched by hand. Neighbours chasing neighbours." highlight={['chasing']} /> },
        { sec: 11, el: <Invitation />, enter: 'slide' },
        { sec: 10, el: <Accountable />, enter: 'slide' },
        { sec: 9, el: <Reliable />, enter: 'slide' },
        { sec: 9, el: <Fast />, enter: 'slide' },
        { sec: 11, el: <Money />, enter: 'slide' },
        { sec: 8, el: <Numbers />, enter: 'wipe' },
        { sec: 12, el: <Outro next="Where" /> },
      ]}
    />
  );
}

