/**
 * 4 of 5 — WHERE can you find it?
 *
 * Store facts checked live (Oct 2026): My Estate Access is on the App Store
 * and Google Play; My Estate Access Guard is on Google Play only.
 */
import { interpolate, useCurrentFrame } from 'remotion';

import { C, Frame, Icon, KeyGlyph, Note, Pill, Title, pop, rise, useFormat, useIn } from '../kit';
import { GuardCheck, MessageBubble, Phone } from '../phone';
import { Above, Beside, Copy, Outro, Scene, Statement, Video, WIntro } from '../scenes';
import { Browser, Dashboard, LandlordView } from '../web';

/** A store search that types the app name and reveals the listing. */
function StoreSearch({ query, app, sub, stores, dark = false, delay = 0 }: { query: string; app: string; sub: string; stores: string[]; dark?: boolean; delay?: number }) {
  const frame = useCurrentFrame();
  const p = useIn(delay, 16);
  const n = Math.floor(interpolate(frame, [delay + 14, delay + 60], [0, query.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const result = useIn(delay + 66, 14);
  const { contentW } = useFormat();
  return (
    <div style={{ width: Math.min(936, contentW), background: C.white, color: C.ink, borderRadius: 36, padding: 34, boxShadow: '0 40px 80px rgba(0,0,0,0.4)', ...rise(p, 60) }}>
      <div style={{ height: 76, borderRadius: 24, background: C.field, display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px', fontSize: 30, fontWeight: 600 }}>
        <Icon name="search" size={32} color={C.muted} />
        <span>{query.slice(0, n)}</span>
        {n < query.length ? <span style={{ width: 3, height: 34, background: C.ink }} /> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 30, ...rise(result, 20) }}>
        <div style={{ width: 120, height: 120, borderRadius: 30, background: dark ? C.ink : C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <KeyGlyph size={76} color={dark ? C.lime : C.ink} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-0.02em' }}>{app}</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: C.muted, marginTop: 4 }}>{sub}</div>
        </div>
        <div style={{ padding: '16px 34px', borderRadius: 999, background: C.ink, color: C.white, fontSize: 26, fontWeight: 800 }}>Get</div>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 30 }}>
        {stores.map((s, i) => (
          <Pill key={s} delay={delay + 80 + i * 8} tone="lime" size={26}>
            <Icon name="store" size={28} /> {s}
          </Pill>
        ))}
      </div>
    </div>
  );
}

function Residents() {
  return (
    <Above
      top={<Copy icon="phone" kicker="Residents" title="Download My Estate Access." size={70} body="Free on the App Store and Google Play." />}
      bottom={<StoreSearch query="My Estate Access" app="My Estate Access" sub="Visitor codes & estate dues" stores={['App Store', 'Google Play']} delay={20} />}
    />
  );
}

function Guards() {
  return (
    <Above
      top={<Copy icon="shield" kicker="Guards" title="My Estate Access Guard, on the gate phone." size={66} body="On Google Play — any Android phone at the gate will do." />}
      bottom={<StoreSearch query="My Estate Access Guard" app="My Estate Access Guard" sub="Check visitor codes at the gate" stores={['Google Play']} dark delay={20} />}
    />
  );
}

function Office() {
  const frame = useCurrentFrame();
  return (
    <Above
      top={<Copy icon="globe" kicker="The estate office" title="Any web browser. Nothing to install." size={66} />}
      bottom={
        <Browser width={936} height={640} delay={10} typeFrom={24} typeTo={70}>
          {frame > 76 ? <Dashboard delay={78} /> : <div style={{ height: '100%', background: C.canvas }} />}
        </Browser>
      }
    />
  );
}

function EmailCard({ delay }: { delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ width: 860, background: C.white, color: C.ink, borderRadius: 30, padding: 30, boxShadow: '0 30px 70px rgba(0,0,0,0.4)', ...rise(p, 40) }}>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.1em', color: C.muted }}>EMAIL · ESTATE DUES ARE DUE</div>
      <div style={{ fontSize: 30, fontWeight: 800, marginTop: 10 }}>₦25,000 due — estate dues for House 3 at Palm Court</div>
      <div style={{ fontSize: 22, color: C.muted, fontWeight: 600, marginTop: 10 }}>You can settle it with the button below. No account or sign-in is needed.</div>
      <div style={{ display: 'inline-block', marginTop: 20, padding: '16px 30px', borderRadius: 999, background: C.lime, fontSize: 24, fontWeight: 800 }}>Pay ₦25,000</div>
    </div>
  );
}

function Landlords() {
  const frame = useCurrentFrame();
  return (
    <Above
      top={<Copy icon="house" kicker="Landlords" title="In their inbox — or on the same website." size={64} body="A payment link that needs no account, or a landlord dashboard for every property." />}
      bottom={
        frame < 150 ? (
          <EmailCard delay={20} />
        ) : (
          <Browser width={936} height={470} delay={150}>
            <LandlordView delay={152} />
          </Browser>
        )
      }
    />
  );
}

function Visitors() {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <Copy icon="msg" kicker="Visitors" title="In the message they already got." body="WhatsApp, SMS or email. Nothing to download." />
        <MessageBubble delay={34} text="Your code for Palm Court is K7Q2MX. Valid until 18:40." style={{ marginTop: 46 }} />
      </Frame>
    </Scene>
  );
}

function AtTheGate() {
  return (
    <Beside
      left={<Copy icon="wifiOff" kicker="Where it works" title="At the gate — even with weak signal." body="The guard's phone checks codes on its own for up to six hours without contact." />}
      right={<Phone scale={0.84} delay={6}><GuardCheck offline from={40} to={120} /></Phone>}
    />
  );
}

function FlowNode({ icon, label, sub, delay, accent = false }: { icon: string; label: string; sub: string; delay: number; accent?: boolean }) {
  const p = useIn(delay, 14);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, background: accent ? C.lime : C.ink2, color: accent ? C.ink : C.white, borderRadius: 30, padding: '24px 28px', ...pop(p) }}>
      <Icon name={icon} size={52} color={accent ? C.ink : C.lime} />
      <div>
        <div style={{ fontSize: 34, fontWeight: 800 }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 600, opacity: 0.75 }}>{sub}</div>
      </div>
    </div>
  );
}

function Arrow({ delay }: { delay: number }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', opacity: p }}>
      <svg width="40" height="56" viewBox="0 0 40 56"><path d="M20 4v40M8 34l12 14 12-14" stroke={C.muted2} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </div>
  );
}

function MoneyGoes() {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center', gap: 14 }}>
        <Title text="And the dues? Straight to the estate." size={72} highlight={['Straight']} style={{ marginBottom: 26 }} />
        <FlowNode icon="phone" label="Resident or landlord pays" sub="By card, in the app or from the link" delay={24} />
        <Arrow delay={36} />
        <FlowNode icon="lock" label="Flutterwave" sub="Handles the card. We never see card details." delay={42} />
        <Arrow delay={54} />
        <FlowNode icon="building" label="The estate's own bank account" sub="It never passes through us." delay={60} accent />
      </Frame>
    </Scene>
  );
}

export function Where() {
  return (
    <Video
      series="Where"
      scenes={[
        { sec: 6, el: <WIntro word="WHERE" question="do you find it?" index={4} /> },
        { sec: 13, el: <Residents />, enter: 'slide' },
        { sec: 12, el: <Guards />, enter: 'slide' },
        { sec: 12, el: <Office />, enter: 'slide' },
        { sec: 11, el: <Landlords />, enter: 'slide' },
        { sec: 8, el: <Visitors />, enter: 'slide' },
        { sec: 8, el: <AtTheGate />, enter: 'slide' },
        { sec: 9, el: <MoneyGoes />, enter: 'wipe' },
        { sec: 7, el: <Statement kicker="Learn more" text="myestateaccess.com" highlight={['myestateaccess.com']} sub="Everything here, and how to bring your estate on board." /> },
        { sec: 13, el: <><Outro next="When" /><Note delay={20}>Screens are simplified. Names and amounts are examples.</Note></> },
      ]}
    />
  );
}
