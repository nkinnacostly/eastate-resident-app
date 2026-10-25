/** 5 of 5 — WHEN do you use it? Every visit, every month, every change. */
import { useCurrentFrame } from 'remotion';

import { C, Frame, Icon, Kicker, Note, Title, pop, rise, useFormat, useIn } from '../kit';
import { DuesScreen, GuardCheck, Notification, Phone, ResidentHome } from '../phone';
import { Above, Beside, Copy, Outro, Scene, Statement, Video, WIntro } from '../scenes';
import { AuditLog, Browser } from '../web';

function Moment({ time, title, sub, icon, delay, last = false }: { time: string; title: string; sub: string; icon: string; delay: number; last?: boolean }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ display: 'flex', gap: 24, ...rise(p, 30) }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 70, height: 70, borderRadius: 35, background: last ? C.coralSoft : C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', ...pop(p) }}>
          <Icon name={icon} size={36} color={last ? C.coralInk : C.ink} />
        </div>
        {!last ? <div style={{ width: 4, flex: 1, minHeight: 70, background: C.ink3, marginTop: 8 }} /> : null}
      </div>
      <div style={{ paddingBottom: 26 }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '0.12em', color: last ? C.coral : C.lime }}>{time}</div>
        <div style={{ fontSize: 38, fontWeight: 800, marginTop: 4, letterSpacing: '-0.02em' }}>{title}</div>
        <div style={{ fontSize: 26, fontWeight: 500, color: 'rgba(255,255,255,0.72)', marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  );
}

function ADay() {
  return (
    <Scene>
      <Frame style={{ justifyContent: 'center' }}>
        <Kicker delay={2}>Every time someone comes to the gate</Kicker>
        <Title text="A day at Palm Court." size={80} delay={6} style={{ marginTop: 16, marginBottom: 36 }} />
        <Moment time="07:30" icon="key" title="The driver arrives" sub="A fresh code each morning — made in seconds." delay={34} />
        <Moment time="10:15" icon="box" title="A courier" sub="A delivery code, with a note for the guard." delay={90} />
        <Moment time="12:40" icon="msg" title="A lunch guest" sub="Code sent on WhatsApp. Resident alerted on arrival." delay={146} />
        <Moment time="18:40" icon="clock" title="The 12:40 code dies" sub="Six hours on, used or not. Nothing left to misuse." delay={202} last />
      </Frame>
      <Note delay={40}>Names and times are examples.</Note>
    </Scene>
  );
}

function NetworkDrops() {
  return (
    <Beside
      left={<Copy icon="wifiOff" kicker="When the network drops" title="Keep checking codes." body="On its own for up to six hours. Everything uploads the moment signal returns." />}
      right={<Phone scale={0.84} delay={6}><GuardCheck offline from={40} to={120} /></Phone>}
    />
  );
}

function ShiftChange() {
  return (
    <Beside
      left={<Copy icon="shield" kicker="When shifts change" title="Residents know who's on duty." body="A new guard starts their shift, and the last one closes automatically." />}
      right={
        <Phone scale={0.84} delay={6}>
          <ResidentHome live={2} />
          <Notification at={50} title="Musa is on duty" body="Musa has started their shift and is ready to receive your visitors." />
        </Phone>
      }
    />
  );
}

function Calendar() {
  // October 2026 starts on a Thursday.
  const offset = 3;
  const marks: Record<number, { label: string; tone: 'lime' | 'dark' | 'coral' }> = {
    1: { label: 'Bills raised · reminder', tone: 'lime' },
    6: { label: 'Reminder', tone: 'dark' },
    8: { label: 'Due', tone: 'coral' },
  };
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const p = useIn(18, 16);
  const { contentW } = useFormat();
  return (
    <div style={{ width: Math.min(936, contentW), background: C.white, color: C.ink, borderRadius: 36, padding: 32, boxShadow: '0 40px 80px rgba(0,0,0,0.4)', ...rise(p, 50) }}>
      <div style={{ fontSize: 32, fontWeight: 800 }}>October</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginTop: 18 }}>
        {days.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, color: C.muted }}>{d}</div>
        ))}
        {Array.from({ length: offset }, (_, i) => <div key={`x${i}`} />)}
        {Array.from({ length: 14 }, (_, i) => i + 1).map((d) => (
          <CalDay key={d} d={d} mark={marks[d]} delay={30 + d * 3} />
        ))}
      </div>
    </div>
  );
}

function CalDay({ d, mark, delay }: { d: number; mark?: { label: string; tone: 'lime' | 'dark' | 'coral' }; delay: number }) {
  const p = useIn(delay, 14);
  const bg = !mark ? C.canvas : mark.tone === 'lime' ? C.lime : mark.tone === 'coral' ? C.coralSoft : C.ink;
  const fg = !mark ? C.ink : mark.tone === 'dark' ? C.white : mark.tone === 'coral' ? C.coralInk : C.ink;
  return (
    <div style={{ height: 96, borderRadius: 18, background: bg, color: fg, padding: 10, ...pop(mark ? p : 1) }}>
      <div style={{ fontSize: 24, fontWeight: 800 }}>{d}</div>
      {mark ? <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.15, marginTop: 4 }}>{mark.label}</div> : null}
    </div>
  );
}

function EveryMonth() {
  return (
    <Above
      top={<Copy icon="calendar" kicker="Every month" title="Dues run themselves." size={72} body="Bills on the 1st. Email reminders 7 days and 2 days before the due date." />}
      bottom={<Calendar />}
    />
  );
}

function PayAhead() {
  return (
    <Beside
      left={<Copy icon="money" kicker="Whenever they like" title="Pay monthly — or a year ahead." body="Monthly, quarterly, half-yearly or yearly. Twelve months costs twelve times the monthly amount." />}
      right={<Phone scale={0.84} delay={6}><DuesScreen pickAt={90} /></Phone>}
    />
  );
}

function ResidentRow({ name, house, suspendAt }: { name: string; house: string; suspendAt?: number }) {
  const frame = useCurrentFrame();
  const suspended = suspendAt !== undefined && frame >= suspendAt;
  const pressing = suspendAt !== undefined && frame >= suspendAt - 8 && frame < suspendAt;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 0', borderTop: `1px solid ${C.line}` }}>
      <div style={{ width: 52, height: 52, borderRadius: 16, background: C.field, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, color: C.muted }}>{name.split(' ').map((w) => w[0]).join('')}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>{name}</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: C.muted }}>{house}</div>
      </div>
      <span style={{ padding: '7px 16px', borderRadius: 999, fontSize: 16, fontWeight: 800, background: suspended ? C.field : C.limeSoft, color: suspended ? C.muted : C.limeInk }}>{suspended ? 'Suspended' : 'Approved'}</span>
      {suspendAt !== undefined && !suspended ? (
        <span style={{ padding: '7px 16px', borderRadius: 999, fontSize: 16, fontWeight: 800, background: pressing ? C.ink : C.field, color: pressing ? C.white : C.muted }}>Suspend</span>
      ) : null}
    </div>
  );
}

function MovesOut() {
  const frame = useCurrentFrame();
  const toast = useIn(118, 14);
  return (
    <Above
      top={<Copy icon="people" kicker="When someone moves out" title="Every code they made stops — at once." size={64} />}
      bottom={
        <Browser width={936} height={560} delay={14}>
          <div style={{ padding: '26px 32px', position: 'relative', height: '100%' }}>
            <div style={{ fontSize: 30, fontWeight: 800 }}>Residents</div>
            <div style={{ marginTop: 16 }}>
              <ResidentRow name="Ada Okafor" house="House 12" />
              <ResidentRow name="Bo Bello" house="House 7 · moving out" suspendAt={110} />
              <ResidentRow name="Cy Chukwu" house="House 4" />
            </div>
            {frame >= 118 ? (
              <div style={{ position: 'absolute', left: 32, right: 32, bottom: 30, background: C.ink, color: C.white, borderRadius: 22, padding: '18px 22px', fontSize: 21, fontWeight: 700, display: 'flex', gap: 14, alignItems: 'center', ...rise(toast, 30) }}>
                <Icon name="check" size={28} color={C.lime} width={2.6} /> Suspended. Every code Bo made has stopped working.
              </div>
            ) : null}
          </div>
        </Browser>
      }
    />
  );
}

function AQuestion() {
  return (
    <Above
      top={<Copy icon="list" kicker="When a question comes up" title="The record has the answer." size={70} body="Every check — and every refusal — with the time and the guard on duty." />}
      bottom={
        <Browser width={936} height={540} delay={16}>
          <AuditLog delay={18} />
        </Browser>
      }
    />
  );
}

export function When() {
  return (
    <Video
      series="When"
      scenes={[
        { sec: 6, el: <WIntro word="WHEN" question="do you use it?" index={5} /> },
        { sec: 16, el: <ADay /> },
        { sec: 9, el: <NetworkDrops />, enter: 'slide' },
        { sec: 9, el: <ShiftChange />, enter: 'slide' },
        { sec: 11, el: <EveryMonth />, enter: 'slide' },
        { sec: 9, el: <PayAhead />, enter: 'slide' },
        { sec: 10, el: <MovesOut />, enter: 'slide' },
        { sec: 8, el: <AQuestion />, enter: 'slide' },
        { sec: 8, el: <Statement kicker="When should your estate start?" text="Today." highlight={['Today.']} sub="A few hundred homes is about an afternoon of admin." />, enter: 'wipe' },
        { sec: 12, el: <Outro /> },
      ]}
    />
  );
}
