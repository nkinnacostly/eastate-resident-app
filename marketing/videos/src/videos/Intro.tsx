/**
 * The introduction, 60 seconds: the gate today, the product, a visit in four
 * steps, the office and dues, then a pointer into the 5 W's series.
 */
import { Easing, interpolate, useCurrentFrame } from 'remotion';

import { Body, C, Frame, Icon, IconTile, INTRO_TOTAL, Kicker, Logo, Note, Title, pop, rise, useFormat, useIn } from '../kit';
import { CodeScreen, DuesScreen, GuardCheck, MessageBubble, Notification, Phone, ResidentHome, Verdict } from '../phone';
import { Above, Beside, Copy, Outro, Scene, Video } from '../scenes';
import { Browser, Dashboard } from '../web';

/** A gate barrier arm swinging down on its post. */
function Barrier({ delay }: { delay: number }) {
  const p = useIn(delay, 14, 1);
  const { contentW } = useFormat();
  return (
    <div style={{ position: 'relative', height: 260 }}>
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: 54, height: 230, borderRadius: 14, background: C.ink3 }} />
      <div
        style={{
          position: 'absolute',
          left: 27,
          bottom: 182,
          width: contentW - 56,
          height: 46,
          borderRadius: 23,
          background: `repeating-linear-gradient(-45deg, ${C.coral} 0 44px, ${C.white} 44px 88px)`,
          transformOrigin: '0 50%',
          transform: `rotate(${(1 - p) * -72}deg)`,
          boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
        }}
      />
      <div style={{ position: 'absolute', left: 9, bottom: 187, width: 36, height: 36, borderRadius: 18, background: C.muted2 }} />
    </div>
  );
}

function ColdOpen() {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'space-between' }}>
        <div style={{ paddingTop: 40 }}>
          <Kicker delay={4}>At the estate gate</Kicker>
          {/* One Title per line, so the breaks fall where the sense does. */}
          <Title text="Someone is" size={120} delay={10} style={{ marginTop: 22 }} />
          <Title text="at the gate." size={120} delay={18} />
          <Title text="Who are they?" size={64} delay={52} color="rgba(255,255,255,0.6)" style={{ marginTop: 30 }} />
          <Title text="Who let them in?" size={64} delay={62} color="rgba(255,255,255,0.6)" />
        </div>
        <Barrier delay={24} />
      </Frame>
    </Scene>
  );
}

/** The guard's phone ringing a resident who doesn't pick up. */
function CallScreen({ failAt }: { failAt: number }) {
  const frame = useCurrentFrame();
  const failed = frame >= failAt;
  // Time-lapsed: the call clock runs five times fast so the wait reads as long.
  const secs = Math.floor(Math.min(frame, failAt) / 6);
  const ring = (frame % 36) / 36;
  const p = useIn(failAt, 14);
  return (
    <div style={{ height: '100%', background: '#1d2025', color: C.white, padding: '150px 30px 0', textAlign: 'center', position: 'relative' }}>
      <div style={{ fontSize: 19, fontWeight: 700, color: failed ? C.coral : C.muted2 }}>{failed ? 'Call ended' : `Calling…  0:${String(secs).padStart(2, '0')}`}</div>
      <div style={{ fontSize: 42, fontWeight: 800, marginTop: 10, letterSpacing: '-0.02em' }}>House 12</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: C.muted2, marginTop: 4 }}>Resident</div>
      <div style={{ position: 'relative', width: 170, height: 170, margin: '60px auto 0' }}>
        {!failed ? (
          <div style={{ position: 'absolute', inset: 0, borderRadius: 85, border: `3px solid ${C.lime}`, transform: `scale(${1 + ring * 0.55})`, opacity: 1 - ring }} />
        ) : null}
        <div style={{ position: 'absolute', inset: 0, borderRadius: 85, background: C.ink3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="house" size={76} color={C.white} />
        </div>
      </div>
      {failed ? (
        <div style={{ display: 'inline-block', marginTop: 50, padding: '12px 26px', borderRadius: 999, background: C.coralSoft, color: C.coralInk, fontSize: 24, fontWeight: 800, ...pop(p) }}>No answer</div>
      ) : null}
      <div style={{ position: 'absolute', bottom: 70, left: '50%', marginLeft: -42, width: 84, height: 84, borderRadius: 42, background: C.coral, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="x" size={40} color={C.white} width={2.6} />
      </div>
    </div>
  );
}

function Problem() {
  return (
    <Beside
      left={<Copy icon="phone" kicker="The gate today" title="The guard calls. Nobody answers." size={66} body="The visitor waits. The visitor book fills with names nobody can check." />}
      right={<Phone scale={0.84} delay={6}><CallScreen failAt={150} /></Phone>}
    />
  );
}

function Reveal() {
  const frame = useCurrentFrame();
  const p = useIn(4, 11, 0.9);
  const ring = interpolate(frame, [6, 44], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ position: 'relative', width: 190, height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: 95, border: `5px solid ${C.lime}`, transform: `scale(${0.7 + ring * 1.9})`, opacity: 1 - ring }} />
          <div style={pop(p)}>
            <Logo size={190} word={false} />
          </div>
        </div>
        <div style={{ marginTop: 56 }}>
          <Kicker delay={20}>Introducing</Kicker>
        </div>
        <Title text="My Estate Access" size={112} delay={24} align="center" highlight={['Access']} style={{ marginTop: 18 }} />
        <Body delay={48} style={{ marginTop: 26, maxWidth: 820 }}>Visitor codes and estate dues — one system for your estate.</Body>
      </Frame>
    </Scene>
  );
}

/** Copy for one step of a visit, under a big step number. */
function Step({ n, title, body }: { n: number; title: string; body: string }) {
  const p = useIn(2, 14);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, ...rise(p, 30) }}>
        <span style={{ fontSize: 128, fontWeight: 800, color: C.lime, letterSpacing: '-0.05em', lineHeight: 1 }}>{`0${n}`}</span>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.16em', color: C.muted2 }}>OF 04</span>
      </div>
      <Copy title={title} body={body} size={64} delay={6} />
    </div>
  );
}

function Create() {
  const frame = useCurrentFrame();
  return (
    <Beside
      left={<Step n={1} title="A resident creates a code." body="One visitor, one entry. It stops working after six hours." />}
      right={<Phone scale={0.84} delay={6}>{frame < 56 ? <ResidentHome live={0} pressAt={40} /> : <CodeScreen landAt={58} />}</Phone>}
    />
  );
}

function Send() {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <Step n={2} title="They send it to the visitor." body="By WhatsApp, SMS or email. The visitor needs no app." />
        <MessageBubble delay={40} text="Your code for Palm Court is K7Q2MX. Valid until 18:40." style={{ marginTop: 50 }} />
      </Frame>
    </Scene>
  );
}

function Check() {
  const frame = useCurrentFrame();
  return (
    <Beside
      left={<Step n={3} title="The guard checks it." body={'Type the code. A plain answer comes back, even with\u00a0no\u00a0signal.'} />}
      right={<Phone scale={0.84} delay={6}>{frame < 100 ? <GuardCheck from={24} to={84} /> : <Verdict ok at={102} />}</Phone>}
    />
  );
}

function Told() {
  return (
    <Beside
      left={<Step n={4} title="The resident gets an alert." body="And the code is spent. It can't be used again." />}
      right={
        <Phone scale={0.84} delay={6}>
          <ResidentHome live={0} />
          <Notification at={20} title="Your visitor has arrived" body="Code K7Q2MX was used at the gate." />
        </Phone>
      }
    />
  );
}

function Office() {
  return (
    <Above
      top={<Copy icon="building" kicker="The estate office" title="Every entry, on one record." size={64} body="Approve residents, see who came in and who let them in, and run dues — in any web browser." />}
      bottom={
        <Browser width={936} height={540} delay={14}>
          <Dashboard delay={18} />
        </Browser>
      }
    />
  );
}

function Dues() {
  return (
    <Beside
      left={<Copy icon="money" kicker="Estate dues, built in" title="Dues come in on time." body="Bills on the 1st. Email reminders. Paid straight into the estate's bank account." />}
      right={<Phone scale={0.84} delay={6}><DuesScreen pickAt={80} /></Phone>}
    />
  );
}

function Benefit({ icon, word, line, delay }: { icon: string; word: string; line: string; delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 26, background: C.ink2, borderRadius: 30, padding: '24px 28px', ...rise(p, 40) }}>
      <IconTile name={icon} size={76} delay={delay} />
      <div>
        <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-0.02em' }}>{word}</div>
        <div style={{ fontSize: 26, fontWeight: 600, color: 'rgba(255,255,255,0.72)', marginTop: 2 }}>{line}</div>
      </div>
    </div>
  );
}

function Benefits() {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center', gap: 16 }}>
        <Title text="What changes at your gate." size={80} highlight={['changes']} style={{ marginBottom: 22 }} />
        <Benefit icon="shield" word="Safer" line="Only invited visitors get in." delay={18} />
        <Benefit icon="clock" word="Faster" line="Seconds at the barrier, not phone calls." delay={28} />
        <Benefit icon="list" word="Accountable" line="Every check is kept — refusals too." delay={38} />
        <Benefit icon="wifiOff" word="Reliable" line="A network outage never closes the gate." delay={48} />
      </Frame>
    </Scene>
  );
}

export function Intro() {
  return (
    <Video
      total={INTRO_TOTAL}
      // The header's logo waits until after the reveal, at the first step.
      headerAt={462}
      scenes={[
        { sec: 4.5, el: <ColdOpen /> },
        { sec: 7, el: <Problem />, enter: 'slide' },
        { sec: 5.5, el: <Reveal />, enter: 'fade' },
        { sec: 6, el: <Create />, enter: 'slide' },
        { sec: 5, el: <Send />, enter: 'slide' },
        { sec: 7, el: <Check />, enter: 'slide' },
        { sec: 4.5, el: <Told />, enter: 'slide' },
        { sec: 5.5, el: <Office />, enter: 'wipe' },
        { sec: 5.5, el: <Dues />, enter: 'slide' },
        { sec: 6, el: <Benefits />, enter: 'wipe' },
        { sec: 9, el: <><Outro next="Who" lead="Start the series" /><Note delay={20}>Screens are simplified. Names and codes are examples.</Note></> },
      ]}
    />
  );
}
