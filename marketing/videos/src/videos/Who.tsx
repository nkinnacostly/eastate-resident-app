/** 1 of 5 — WHO needs it? Everyone at the gate, each with what they use. */
import { useCurrentFrame } from 'remotion';

import { C, Frame, IconTile, Note, Title, pop, useIn } from '../kit';
import { CodeScreen, GuardCheck, MessageBubble, Notification, Phone, ResidentHome, Verdict } from '../phone';
import { Above, Beside, Copy, Outro, Scene, Statement, Video, WIntro } from '../scenes';
import { AgencyCounts, Browser, Dashboard, LandlordView } from '../web';

function Residents() {
  const frame = useCurrentFrame();
  return (
    <Beside
      left={<Copy icon="people" kicker="Residents" title="Invite a guest in seconds." body="No phone calls from the gate. A code for every visitor, delivery or driver — and an alert when they arrive." />}
      right={
        <Phone scale={0.88} delay={6}>
          {frame < 70 ? <ResidentHome live={1} pressAt={46} /> : <CodeScreen landAt={72} />}
          <Notification at={230} title="Your visitor has arrived" body="Code K7Q2MX was used at the gate." />
        </Phone>
      }
    />
  );
}

function Guards() {
  const frame = useCurrentFrame();
  return (
    <Beside
      left={<Copy icon="shield" kicker="Guards" title="One phone. Plain answers." body="Type the code. The app says “Let them in” — or “Do not admit”, and why. Even with no signal." />}
      right={<Phone scale={0.88} delay={6}>{frame < 120 ? <GuardCheck from={30} to={100} /> : <Verdict ok at={122} />}</Phone>}
    />
  );
}

function Office() {
  return (
    <Above
      top={<Copy icon="building" kicker="The estate office & committee" title="Approve residents. See every entry. Run dues." size={64} />}
      bottom={
        <Browser width={936} height={600} delay={14}>
          <Dashboard delay={18} />
        </Browser>
      }
    />
  );
}

function Landlords() {
  return (
    <Above
      top={<Copy icon="house" kicker="Landlords" title="Pay dues from anywhere, for every property." size={64} body="No account needed — or sign up with the email the estate has on record." />}
      bottom={
        <Browser width={936} height={500} delay={16}>
          <LandlordView delay={20} />
        </Browser>
      }
    />
  );
}

function Agencies() {
  return (
    <Above
      top={<Copy icon="chart" kicker="Security companies" title="See their service — as counts only." size={64} body="Shifts, hours and entries. Never residents, visitors or codes." />}
      bottom={
        <Browser width={820} height={470} delay={16}>
          <AgencyCounts delay={20} />
        </Browser>
      }
    />
  );
}

function Visitors() {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <Copy icon="msg" kicker="Visitors" title="Need nothing at all." body="No app. No account. They read six characters out at the gate." />
        <MessageBubble delay={34} text="Your code for Palm Court is K7Q2MX. Valid until 18:40." style={{ marginTop: 46 }} />
      </Frame>
      <Note delay={40}>Names and codes are examples.</Note>
    </Scene>
  );
}

function Everyone() {
  const roles = [
    ['people', 'Residents'],
    ['shield', 'Guards'],
    ['building', 'Estate office'],
    ['house', 'Landlords'],
    ['chart', 'Security companies'],
    ['msg', 'Visitors'],
  ];
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <Title text="One system. Everyone at the gate." size={88} highlight={['Everyone']} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 50 }}>
          {roles.map(([icon, label], i) => (
            <Role key={label} icon={icon} label={label} delay={20 + i * 6} />
          ))}
        </div>
      </Frame>
    </Scene>
  );
}

function Role({ icon, label, delay }: { icon: string; label: string; delay: number }) {
  const p = useIn(delay, 15);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, background: C.ink2, borderRadius: 28, padding: '20px 22px', ...pop(p) }}>
      <IconTile name={icon} size={64} delay={delay} />
      <span style={{ fontSize: 32, fontWeight: 800 }}>{label}</span>
    </div>
  );
}

export function Who() {
  return (
    <Video
      series="Who"
      scenes={[
        { sec: 6, el: <WIntro word="WHO" question="needs My Estate Access?" index={1} /> },
        { sec: 7, el: <Statement kicker="Every estate gate asks" text="Who is this — and who let them in?" highlight={['Who', 'who']} /> },
        { sec: 13, el: <Residents />, enter: 'slide' },
        { sec: 12, el: <Guards />, enter: 'slide' },
        { sec: 12, el: <Office />, enter: 'slide' },
        { sec: 10, el: <Landlords />, enter: 'slide' },
        { sec: 9, el: <Agencies />, enter: 'slide' },
        { sec: 9, el: <Visitors />, enter: 'slide' },
        { sec: 8, el: <Everyone />, enter: 'wipe' },
        { sec: 12, el: <Outro next="What" /> },
      ]}
    />
  );
}
