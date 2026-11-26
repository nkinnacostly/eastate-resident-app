/**
 * "My Estate Access — a walkthrough for the Board of Trustees".
 *
 * A 16:9 film, under ten minutes, captions and music only, made for a South
 * African estate's trustees: what the product is, onboarding step by step
 * (who does what), a visit, offline working, the dashboard, levies, owners and
 * security companies, POPIA, and the first steps. Every claim matches the
 * 10-page brochure, which was fact-checked against the code on 26 Nov 2026.
 *
 * Timing lives in timeline.json, shared with music/explainer.py.
 */
import { Audio } from '@remotion/media';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import type { ReactNode } from 'react';
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import { Body, C, Drift, Kicker, Logo, Stage, Title, rise, useIn } from '../kit';
import { Phone } from '../phone';
import {
  AuditPage, CodesPage, DuesSetupPage, Email, GuardProfilePage, GuardsPage, HouseCodeEmail, ImportPage, MailBtn,
  OverviewPage, PaymentsPage, ResidentsPage, SettingsPage, SignInPage, Spreadsheet, Desk,
} from './desk';
import {
  ChoosePassword, ConfirmEmail, DeliveryNote, DeliveryPrompt, DuesTab, ESTATE, ESTATE_CODE, FlagFlow,
  GUARD, GuardVerdict, HOUSE_CODE, Home, Keypad, LogTab, Pass, Push, ScanScreen, SendSheet, SignUp, StartShift, VisitorChat,
  Waiting,
} from './screens';
import timeline from './timeline.json';
import { Bullets, Chapter, Pair, Rows, Scene, Split, Statement, Step, Tiles, useLayout } from './ui';

const FPS = timeline.fps;
const T = timeline.T;
const STEPS = 13;

const ph = (el: ReactNode, scale = 0.86, delay = 0) => <Phone scale={scale} delay={delay}>{el}</Phone>;

/** Every scene, chapter by chapter. Counts must match timeline.json. */
function chapters(): ReactNode[][] {
  return [
    // 0 Welcome
    [
      <Opening key="o" />,
      <Contents key="c" />,
    ],
    // 1 Why it exists
    [
      <Statement key="a" kicker="Why it exists" text="Most estate gates still run on a register, a phone call and a guess." />,
      <Tiles key="b" kicker="At the gate today" title="Three things go wrong" tiles={[
        { icon: 'people', title: 'Anyone can give any name', text: 'A visitor names a resident and walks in. Nothing ties them to an invitation.' },
        { icon: 'phone', title: 'The guard calls, nobody answers', text: 'The visitor waits at the boom while a resident’s phone rings out.' },
        { icon: 'list', title: 'A register nobody can search', text: 'After an incident, no one can say who came in, whose guest, or which guard let them in.' },
      ]} />,
      <Statement key="c" kicker="The idea" text="Give visitors a code, not your gate." highlight={['code,']} sub="A resident sends a one-time code. The guard checks it in seconds. Every check is on record. And levies can be paid in the same app." />,
    ],
    // 2 The three pieces
    [
      <Tiles key="a" kicker="The three pieces" title="Two apps and one website" tiles={[
        { icon: 'phone', title: 'My Estate Access', text: 'For residents, on iPhone and Android: visitor codes, QR passes, notifications and levies.' },
        { icon: 'shield', title: 'My Estate Access Guard', text: 'For the gate, on one Android phone: scan or type a code, online or offline.' },
        { icon: 'globe', title: 'The dashboard', text: 'app.myestateaccess.com, in any browser: for the trustees and the estate office.' },
      ]} />,
      <Split key="b" kicker="Nothing to install at the gate" title="No booms, readers or cards to buy." body="One ordinary Android phone at the gate, and the phones residents already carry. Visitors install nothing at all." visual={<Pair left={ph(<Home live={1} />, 0.8)} right={ph(<Keypad from={10} to={50} />, 0.8, 8)} leftCap="Resident" rightCap="Guard" />} vZoom={0.95} />,
    ],
    // 3 Onboarding
    [
      <Chapter key="ch" n={1} title="Onboarding, step by step" sub="Who does what, from the board's decision to the first visitor at the gate. A few hours of set-up, then a week or two of residents joining." />,
      <Step key="s1" n={1} of={STEPS} who="The board" title="Decide a few things first" bullets={['Who runs the dashboard: usually the estate manager or managing agent', 'The start date', 'Whether to collect levies through the app', 'The Information Officer, and our operator agreement under POPIA']} visual={<DecisionCard />} />,
      <Step key="s2" n={2} of={STEPS} who="Us" title="We create your estate and its sign-ins" body="The administrator is emailed a link to set their own password, then signs in at app.myestateaccess.com. Trustees who want a sign-in get one too." visual={<div style={{ display: 'flex', flexDirection: 'column', gap: 28, alignItems: 'center' }}><div style={{ zoom: 0.9 }}><Email subject="Your estate is ready" to="manager@silveroaks.co.za" width={900}>{ESTATE} is set up on myestateaccess. Set your password to sign in to the dashboard.<br /><MailBtn>Set your password</MailBtn></Email></div><div style={{ zoom: 0.72 }}><Desk nav={false} width={1000} height={560} delay={40}><SignInPage from={80} /></Desk></div></div>} copyW={560} vZoom={0.96} />,
      <Step key="s3" n={3} of={STEPS} who="Estate office" title="Gather the house list" body="One row per erf, stand or unit, with the owner's name, cell number (with +27) and email address. Only the house column is required." visual={<div style={{ zoom: 0.9 }}><Spreadsheet delay={6} /></div>} copyW={560} vZoom={0.96} />,
      <Step key="s4" n={4} of={STEPS} who="Estate office, with us" title="Import it in one go" body="Headings like Erf, Stand, Unit, Owner, Cell and Email are recognised. You see a preview first; nothing is created until you press Import. Up to 2,000 houses at a time." visual={<div style={{ zoom: 0.92 }}><ImportPage pressAt={150} /></div>} copyW={560} vZoom={0.87} />,
      <Step key="s5" n={5} of={STEPS} who="Automatic" title="Every house gets its own code" body="Owners with an email address are sent their house code automatically. Export all codes for the rest. The 8-character estate code is on the Settings page." visual={<div style={{ display: 'flex', flexDirection: 'column', gap: 26, alignItems: 'center' }}><div style={{ zoom: 0.92 }}><HouseCodeEmail delay={6} /></div><div style={{ zoom: 0.62 }}><SettingsPage /></div></div>} copyW={560} vZoom={0.96} />,
      <Step key="s6" n={6} of={STEPS} who="Estate office" title="Register each guard" body="Name, email and cell. A new guard gets a temporary password, shown once, and an email to set their own. Someone with an account already gets an invitation in the app." visual={<div style={{ zoom: 0.92 }}><GuardsPage pressAt={86} /></div>} copyW={560} vZoom={0.87} />,
      <Step key="s7" n={7} of={STEPS} who="Estate office, with your security company" title="Set up the gate phone" body="Install My Estate Access Guard from Google Play. On first sign-in each guard chooses their own password. Keep a charger and a power bank at the gate." visual={<Pair left={ph(<ChoosePassword from={10} />, 0.8)} right={ph(<StartShift from={20} />, 0.8, 8)} leftCap="First sign-in" rightCap="Every shift" />} vZoom={0.95} />,
      <Step key="s8" n={8} of={STEPS} who="Trustees" title="Add the HOA's bank account" body="Choose South Africa, the bank and the account number, and type the account holder's name exactly as the bank has it. Only the last four digits are ever shown, and every administrator and our team are emailed when it changes." visual={<div style={{ zoom: 0.9 }}><DuesSetupPage stage="account" at={10} /></div>} copyW={560} size={54} vZoom={0.87} />,
      <Step key="s9" n={9} of={STEPS} who="Trustees" title="Set the levy" body="Who pays (the owner of each house, or each resident), ZAR, the monthly amount and the days to pay. Bills are raised on the 1st of every month." visual={<div style={{ zoom: 0.9 }}><DuesSetupPage stage="billing" at={10} /></div>} copyW={560} vZoom={0.87} />,
      <Step key="s10" n={10} of={STEPS} who="Estate office" title="Tell the residents" body="Send each household the estate code and its house code, with the start date. We provide a ready-to-send message." visual={<MessageCard />} copyW={600} />,
      <Step key="s11" n={11} of={STEPS} who="Residents" title="Residents download the app and ask to join" body="They sign up with both codes, tap Request access, and confirm their email address. Until the office approves them, they wait." visual={<Pair left={ph(<SignUp from={8} />, 0.8)} right={ph(<WaitFlow />, 0.8, 10)} leftCap="Join your estate" rightCap="Confirm, then wait" />} vZoom={0.95} />,
      <Step key="s12" n={12} of={STEPS} who="Estate office" title="Approve them, one at a time or all at once" body="Each request shows the house it is for. Decline anyone you don't recognise. Family members join with the same house code." visual={<div style={{ zoom: 0.92 }}><ResidentsPage pressAt={120} /></div>} copyW={560} vZoom={0.87} />,
      <Step key="s13" n={13} of={STEPS} who="Guards" title="Go live" body="On the start day the guard on duty signs in. That starts the shift, downloads the live codes, and tells every resident who is on duty." visual={<Pair left={ph(<StartShift from={6} />, 0.8)} right={ph(<HomeWithPush at={70} title={`${GUARD} is on duty`} body={`${GUARD} has started their shift and is ready to receive your visitors.`} />, 0.8, 8)} leftCap="The guard signs in" rightCap="Residents are told" />} vZoom={0.95} />,
      <Recap key="r" />,
    ],
    // 4 A visit
    [
      <Chapter key="ch" n={2} title="A visit, start to finish" sub="From the resident's phone to the boom, with or without signal." />,
      <Split key="a" kicker="1 · The resident" title="Tap Generate code" body="Home shows how many live codes the resident has: up to three at a time." visual={ph(<Home live={1} pressAt={60} />, 0.9)} vZoom={0.95} />,
      <Split key="b" kicker="2 · Deliveries" title="A delivery can carry instructions" body="Up to 200 characters for the courier, such as where to leave a parcel. They travel with the code." visual={<Pair left={ph(<DeliveryPrompt pressAt={50} />, 0.8)} right={ph(<DeliveryNote from={20} />, 0.8, 10)} />} vZoom={0.95} />,
      <Split key="c" kicker="3 · The pass" title="The code arrives as a pass" bullets={['Six characters, nothing to misread: no O or 0, no I or 1', 'A QR holding the code and nothing else', 'The time it stops working, and ONE ENTRY ONLY']} visual={ph(<Pass />, 0.9)} vZoom={0.95} />,
      <Split key="d" kicker="4 · Sending it" title="Send QR pass, or send it as text" body="The pass goes as a picture through WhatsApp or any messaging app, or as a text message by WhatsApp, SMS or email." visual={ph(<SendSheet at={20} pick="qr" />, 0.9)} vZoom={0.95} />,
      <Split key="e" kicker="5 · The visitor" title="The visitor installs nothing" body="They hold up the QR, or read out the six characters. A phone that receives a message is enough." visual={ph(<VisitorChat at={10} />, 0.9)} vZoom={0.95} />,
      <Split key="f" kicker="6 · The gate" title="The guard scans it, or types it" body="A good code shows Let them in, with the resident's name and house when online. It is used up on the spot." visual={<Pair left={ph(<ScanScreen at={10} />, 0.8)} right={ph(<GuardVerdict ok at={40} />, 0.8, 30)} />} vZoom={0.95} />,
      <Split key="g" kicker="7 · The resident" title="Within a minute, the resident knows" body="“Your visitor has arrived.” No phone call from the gate." visual={ph(<HomeWithPush at={30} title="Your visitor has arrived" body="Code K7Q2MX was used at the gate." />, 0.9)} vZoom={0.95} />,
      <Split key="h" kicker="Refusals" title="A refusal always says why" visual={ph(<GuardVerdict ok={false} reason="Already used" at={8} />, 0.9)} bullets={['No such code', 'Expired', 'Already used', 'Cancelled by the estate']} vZoom={0.95} />,
      <Split key="i" kicker="The rules" title="Every code follows the same rules" visual={<Rows delay={16} keyW={260} rows={[['One entry', 'Used once, then gone.'], ['Six hours', 'Dead six hours after it was made, used or not.'], ['Three at a time', 'Up to three live codes per resident.'], ['No standing codes', 'Domestic workers and contractors get a fresh code each visit: a few seconds for the resident.']]} />} copyW={560} />,
    ],
    // 5 Offline
    [
      <Chapter key="ch" n={3} title="When the network is down" sub="Load-shedding takes cell towers down with it. The gate keeps working." />,
      <Split key="a" kicker="Offline" title="The gate phone checks codes on its own" body="It keeps the estate's live codes, refreshed every 45 seconds while open, and crosses each off as it is used. It holds no names, so a lost phone reveals nothing." visual={<Pair left={ph(<Keypad offline from={10} to={60} />, 0.8)} right={ph(<GuardVerdict ok offline at={70} />, 0.8, 50)} leftCap="Checking on this phone" rightCap="No host name offline" />} vZoom={0.95} />,
      <Split key="b" kicker="When signal returns" title="Everything uploads, and is checked again" bullets={['A code made after the signal dropped isn’t on the phone yet: it shows No such code', 'If the server disagrees on upload (expired, revoked, used elsewhere), the entry is recorded with that reason', 'After six hours without contact, the phone stops checking and asks to reconnect']} visual={ph(<LogTab />, 0.9)} vZoom={0.95} />,
      <Split key="c" kicker="Judgement calls" title="Allowed, and never invisible" body="If the offline phone refuses a code, the guard may admit anyway and flag it. The entry reaches the dashboard's Flagged entries with the guard's name on it." visual={ph(<FlagFlow pressAt={110} />, 0.9)} vZoom={0.95} />,
    ],
    // 6 Running the estate
    [
      <Chapter key="ch" n={4} title="Running the estate" sub="The dashboard, day to day, for the trustees and the estate office." />,
      <Split key="a" kicker="Today at the gate" title="The estate at a glance" body="Admitted and refused today, live codes, people waiting for approval, and the latest entries." visual={<div style={{ zoom: 0.92 }}><OverviewPage /></div>} copyW={520} vZoom={0.87} />,
      <Split key="b" kicker="Codes" title="Revoke any live code" body="At once online, and on an offline gate phone at its next sync. Suspending a resident revokes all their codes." visual={<div style={{ zoom: 0.92 }}><CodesPage pressAt={110} /></div>} copyW={520} vZoom={0.87} />,
      <Split key="c" kicker="Audit log" title="A record nobody can edit" body="Every check, with the outcome, the reason for any refusal, the guard and the host. Not a guard, a resident or an administrator can change it." visual={<div style={{ zoom: 0.92 }}><AuditPage /></div>} copyW={520} vZoom={0.87} />,
      <Split key="d" kicker="Guards" title="Shifts, records, and removing a guard who leaves" body="Hours, checks and PSIRA details per guard. Remove a guard and the server refuses them at once; their phone clears its codes when it next checks in." visual={<div style={{ zoom: 0.92 }}><GuardProfilePage pressAt={150} /></div>} copyW={520} size={54} vZoom={0.87} />,
    ],
    // 7 Levies
    [
      <Chapter key="ch" n={5} title="Levies" sub="Optional, in rand, paid out to the HOA's own bank account. In the apps, levies are called dues." />,
      <Split key="a" kicker="For the payer" title="Monthly, or up to a year ahead" body="Once a month is billed, payers choose monthly, quarterly, half-yearly or yearly. No discount, no surcharge from us." visual={ph(<DuesTab pickAt={150} />, 0.9)} vZoom={0.95} />,
      <Split key="b" kicker="Where the money goes" title="Straight to the HOA, never through us" body="Flutterwave splits each payment at source and pays the HOA's share to its own account. Any platform fee is agreed in your quotation and shown on every payment." visual={<MoneyFlow />} copyW={600} />,
      <Split key="c" kicker="Keeping on top of it" title="Reminders and a full payment record" bullets={['Emails 7 and 2 days before each due date, and a Remind button', 'Every payment and failed attempt, with the fee and the payout', 'Export it for the treasurer; waive a month with the reason kept']} visual={<div style={{ zoom: 0.92 }}><PaymentsPage /></div>} copyW={520} vZoom={0.87} />,
      <Split key="d" kicker="An optional rule for arrears" title="Pause new visitor codes, never entry" bullets={['Off unless the trustees switch it on, with the rule or resolution recorded', 'Codes already sent still work; it lifts when nothing is overdue', 'CSOS treats rules that prevent or limit access over unpaid levies as undesirable: take legal advice first']} visual={<CautionCard />} copyW={760} size={56} />,
    ],
    // 8 Owners and security companies
    [
      <Chapter key="ch" n={6} title="Owners and security companies" sub="Each given what they need, nothing more." />,
      <Tiles key="a" cols={2} kicker="Owners and security companies" title="Counts and contacts, never anyone's private details" tiles={[
        { icon: 'house', title: 'Owners get their house code', text: 'Emailed when the house is added, to pass to their tenants.' },
        { icon: 'link', title: 'Owners pay with no account', text: 'From the link in their reminder email, or from an account that shows all their properties.' },
        { icon: 'shield', title: 'Security companies see their service', text: 'Officers posted, shifts and hours, a monthly return, PSIRA expiry dates.' },
        { icon: 'lock', title: 'Counts only', text: 'Never a resident, a visitor, a code or an individual entry. Owners never see tenants’ names.' },
      ]} />,
    ],
    // 9 Privacy and POPIA
    [
      <Chapter key="ch" n={7} title="Privacy and POPIA" sub="The HOA stays in charge of its residents' information." />,
      <Tiles key="a" cols={2} kicker="POPIA" title="Who is responsible for what" tiles={[
        { icon: 'building', title: 'The HOA is the responsible party', text: 'We are its operator, under the written agreement section 21 requires.' },
        { icon: 'lock', title: 'Least access', text: 'Both codes and approval to join. Guards see a host only for a valid code, online.' },
        { icon: 'check', title: 'No more than needed', text: 'No tracking, number plates or photos. Never a full card number.' },
        { icon: 'globe', title: 'Where it lives', text: 'Hosted in the EU (Ireland), on a section 72 basis set out in our privacy policy.' },
      ]} />,
      <Split key="b" kicker="Retention" title="How long records are kept" visual={<Rows delay={14} keyW={280} rows={[['Gate log', 'Names removed after 90 days, or 30 to 180 days as the HOA asks. The entry stays.'], ['Flagged entries', 'Three years.'], ['Shift records', 'Four years.'], ['A deleted account', 'Personal details removed at once.']]} />} copyW={520} />,
    ],
    // 10 Getting started
    [
      <Split key="a" kicker="Getting started" title="What we need from the estate" visual={<Rows delay={12} step={8} keyW={330} size={25} rows={[['The board’s go-ahead', 'and a start date'], ['Administrator and trustees', 'name, email and cell for each sign-in'], ['The house list', 'as a spreadsheet'], ['The guards', 'name, email and cell; a security company contact'], ['A gate phone', 'Android, mobile data, charger, power bank'], ['For levies', 'bank details, account holder name, amount, who pays'], ['POPIA', 'the Information Officer; the operator agreement, signed']]} />} copyW={480} />,
      <Closing key="b" />,
    ],
  ];
}

// ─── Bespoke scenes ──────────────────────────────────────────────────────────

function Opening() {
  const p = useIn(2, 16);
  const { vertical, pad } = useLayout();
  return (
    <Scene>
      <div style={{ position: 'absolute', ...pad, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={rise(p, 30)}><Logo size={84} /></div>
        <Title text="A walkthrough for the Board of Trustees" size={vertical ? 92 : 104} delay={10} style={{ marginTop: 40, maxWidth: 1500 }} />
        <Body delay={34} size={36} style={{ marginTop: 30 }}>Prepared for Jaco Janse van Vuuren and the trustees · 26 November 2026</Body>
        <Body delay={44} size={24} style={{ marginTop: 40, color: C.muted2 }}>Screens are simplified illustrations of the real apps. Names, codes and amounts are examples.</Body>
      </div>
    </Scene>
  );
}

function Contents() {
  const items = ['Why it exists', 'The three pieces', '1 · Onboarding, step by step', '2 · A visit, start to finish', '3 · When the network is down', '4 · Running the estate', '5 · Levies', '6 · Owners and security companies', '7 · Privacy and POPIA', 'Getting started'];
  const { vertical, pad } = useLayout();
  return (
    <Scene>
      <div style={{ position: 'absolute', ...pad, display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: vertical ? 40 : 100, alignItems: vertical ? 'stretch' : 'center', justifyContent: 'center' }}>
        <div style={{ width: vertical ? undefined : 620 }}>
          <Kicker delay={2}>In this film</Kicker>
          <Title text="Everything, from onboarding to the gate" size={vertical ? 64 : 76} delay={6} style={{ marginTop: 18 }} />
        </div>
        <div style={{ flex: vertical ? undefined : 1, display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
          {items.map((t, i) => <ContentRow key={t} text={t} delay={16 + i * 5} />)}
        </div>
      </div>
    </Scene>
  );
}

function ContentRow({ text, delay }: { text: string; delay: number }) {
  const p = useIn(delay, 18);
  return <div style={{ fontSize: 34, fontWeight: 700, padding: '10px 0', borderBottom: `1px solid ${C.ink3}`, color: text.match(/^\d/) ? C.white : C.muted2, ...rise(p, 14) }}>{text}</div>;
}

function DecisionCard() {
  const items = ['Administrator', 'Start date', 'Levies: yes or no', 'Who pays, and how much', 'Arrears rule: usually off', 'Information Officer', 'Operator agreement'];
  return (
    <div style={{ background: C.white, color: C.ink, borderRadius: 30, padding: '30px 36px', width: 620, boxShadow: '0 40px 80px rgba(0,0,0,0.45)' }}>
      <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.12em', color: C.muted }}>TRUSTEES&apos; MEETING · DECISIONS</div>
      {items.map((t, i) => <CheckLine key={t} text={t} delay={20 + i * 10} />)}
    </div>
  );
}

function CheckLine({ text, delay }: { text: string; delay: number }) {
  const p = useIn(delay, 14);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: `1px solid ${C.line}`, fontSize: 26, fontWeight: 700 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, border: `2.5px solid ${C.ink}`, background: p > 0.5 ? C.lime : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800 }}>{p > 0.5 ? '✓' : ''}</div>
      {text}
    </div>
  );
}

function MessageCard() {
  const p = useIn(8, 16);
  return (
    <div style={{ background: '#e9fbd8', color: C.ink, borderRadius: '30px 30px 30px 8px', padding: '26px 30px', width: 820, fontSize: 24, lineHeight: 1.5, fontWeight: 600, boxShadow: '0 30px 60px rgba(0,0,0,0.4)', ...rise(p, 30) }}>
      Dear residents, from 1 December visitor access at {ESTATE} moves to <b>My Estate Access</b>. Download it from the App Store or Google Play, sign up and enter:
      <div style={{ display: 'flex', gap: 14, marginTop: 16 }}>
        <div style={{ background: C.white, borderRadius: 16, padding: '12px 18px' }}><div style={{ fontSize: 13, fontWeight: 800, color: C.muted, letterSpacing: '0.1em' }}>ESTATE CODE</div><div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '0.1em' }}>{ESTATE_CODE}</div></div>
        <div style={{ background: C.white, borderRadius: 16, padding: '12px 18px' }}><div style={{ fontSize: 13, fontWeight: 800, color: C.muted, letterSpacing: '0.1em' }}>YOUR HOUSE CODE</div><div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '0.1em' }}>{HOUSE_CODE}</div></div>
      </div>
      <div style={{ marginTop: 14 }}>The estate office approves each request. Your visitors don&apos;t need the app.</div>
    </div>
  );
}

function WaitFlow() {
  const frame = useCurrentFrame();
  return frame < 120 ? <ConfirmEmail from={30} /> : <Waiting />;
}

function HomeWithPush({ at, title, body }: { at: number; title: string; body: string }) {
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Home live={0} />
      <Push at={at} title={title} body={body} />
    </div>
  );
}

function Recap() {
  const { vertical, pad } = useLayout();
  const steps = [['Decide', 'The board'], ['Set up', 'Us and the office'], ['Residents join', 'Weeks 1 and 2'], ['Go live', 'The start day'], ['First month', 'Review with us']];
  return (
    <Scene>
      <div style={{ position: 'absolute', ...pad, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <Kicker delay={2}>Onboarding in one line</Kicker>
        <Title text="Decide, set up, invite, go live, review." size={vertical ? 70 : 84} delay={6} style={{ marginTop: 18 }} />
        <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: vertical ? 14 : 18, marginTop: vertical ? 40 : 50 }}>
          {steps.map(([t, s], i) => <RecapBox key={t} title={t} sub={s} delay={24 + i * 8} last={i === steps.length - 1} first={i === 0} />)}
        </div>
      </div>
    </Scene>
  );
}

function RecapBox({ title, sub, delay, first, last }: { title: string; sub: string; delay: number; first: boolean; last: boolean }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ flex: 1, borderRadius: 26, padding: '26px 24px', background: last ? C.lime : first ? C.white : C.ink2, color: last || first ? C.ink : C.white, ...rise(p, 30) }}>
      <div style={{ fontSize: 34, fontWeight: 800 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 6, opacity: 0.75 }}>{sub}</div>
    </div>
  );
}

function MoneyFlow() {
  const boxes = [['Owner or resident pays', 'In the app, or from the email link'], ['Flutterwave', 'Takes the card payment and splits it'], ["The HOA's own account", 'Paid out to its bank account']];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: 640 }}>
      {boxes.map(([t, s], i) => <FlowBox key={t} title={t} sub={s} delay={14 + i * 14} hi={i === 2} arrow={i < 2} />)}
    </div>
  );
}

function FlowBox({ title, sub, delay, hi, arrow }: { title: string; sub: string; delay: number; hi: boolean; arrow: boolean }) {
  const p = useIn(delay, 16);
  return (
    <div style={{ ...rise(p, 24) }}>
      <div style={{ borderRadius: 24, padding: '22px 26px', background: hi ? C.lime : C.ink2, color: hi ? C.ink : C.white }}>
        <div style={{ fontSize: 30, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 21, fontWeight: 600, marginTop: 4, opacity: 0.75 }}>{sub}</div>
      </div>
      {arrow ? <div style={{ textAlign: 'center', fontSize: 34, color: C.lime, marginTop: 8, lineHeight: 1 }}>↓</div> : null}
    </div>
  );
}

function CautionCard() {
  const p = useIn(10, 16);
  return (
    <div style={{ width: 560, background: C.ink2, borderRadius: 30, padding: '32px 34px', ...rise(p, 30) }}>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.12em', color: C.lime }}>OUR ADVICE</div>
      <div style={{ fontSize: 40, fontWeight: 800, marginTop: 12, lineHeight: 1.15 }}>Leave it off unless your lawyers say otherwise.</div>
      <div style={{ fontSize: 24, fontWeight: 500, marginTop: 14, lineHeight: 1.45, color: 'rgba(255,255,255,0.75)' }}>Whatever is owed, nobody&apos;s own access to the estate is ever affected.</div>
    </div>
  );
}

function Closing() {
  const p = useIn(2, 16);
  const { vertical, pad } = useLayout();
  return (
    <Scene>
      <div style={{ position: 'absolute', ...pad, display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: vertical ? 50 : 90, alignItems: vertical ? 'stretch' : 'center', justifyContent: 'center' }}>
        <div style={{ flex: vertical ? undefined : 1 }}>
          <div style={rise(p, 30)}><Logo size={vertical ? 70 : 80} /></div>
          <Title text="Give visitors a code, not your gate." size={vertical ? 72 : 84} delay={8} highlight={['code,']} style={{ marginTop: vertical ? 26 : 34 }} />
          <Body delay={30} size={vertical ? 28 : 32} style={{ marginTop: vertical ? 18 : 26 }}>One entry. Six hours. A record of everything.</Body>
        </div>
        <div style={{ width: vertical ? undefined : 640 }}>
          <Kicker delay={20}>Next steps</Kicker>
          <Bullets delay={28} step={10} size={28} items={['Questions from the board, or a live demonstration', 'Your quotation, priced per home', 'Agree the start date and sign the operator agreement', 'Set up and go live']} />
          <div style={{ marginTop: 34 }}>
            <Kicker delay={70}>Contact</Kicker>
            <Body delay={74} size={30} style={{ marginTop: 12, color: C.white }}>Costly Ayang and Eradiri Richard</Body>
            <Body delay={78} size={30} style={{ color: C.lime, fontWeight: 800 }}>hello@myestateaccess.com</Body>
            <Body delay={82} size={26}>myestateaccess.com</Body>
          </div>
        </div>
      </div>
    </Scene>
  );
}

// ─── The film ────────────────────────────────────────────────────────────────

type Placed = { el: ReactNode; frames: number; chapter: number };

function place(): { scenes: Placed[]; total: number; starts: number[] } {
  const els = chapters();
  const scenes: Placed[] = [];
  els.forEach((list, c) => {
    const secs = timeline.chapters[c].scenes;
    if (secs.length !== list.length) throw new Error(`Chapter ${c} (${timeline.chapters[c].title}): ${list.length} scenes, timeline has ${secs.length}`);
    list.forEach((el, i) => scenes.push({ el, frames: Math.round(secs[i] * FPS), chapter: c }));
  });
  // Scene k starts at sum(frames before it) - k*T, because each transition overlaps two scenes.
  let t = 0;
  const starts: number[] = [];
  scenes.forEach((s, k) => {
    starts.push(t);
    t += s.frames - (k < scenes.length - 1 ? T : 0);
  });
  return { scenes, total: t, starts };
}

export function filmFrames(): number {
  const secs = timeline.chapters.flatMap((c) => c.scenes);
  return secs.reduce((a, s) => a + Math.round(s * FPS), 0) - T * (secs.length - 1);
}

export function Film() {
  const { scenes, starts } = place();
  return (
    <Stage>
      <Audio src={staticFile('music/trustees.m4a')} />
      <TransitionSeries>
        {scenes.flatMap((s, i) => {
          const seq = (
            <TransitionSeries.Sequence key={`s${i}`} durationInFrames={s.frames}>
              <Drift amount={0.025}>{s.el}</Drift>
            </TransitionSeries.Sequence>
          );
          return i === 0 ? [seq] : [<TransitionSeries.Transition key={`t${i}`} timing={linearTiming({ durationInFrames: T })} presentation={fade()} />, seq];
        })}
      </TransitionSeries>
      <FilmHeader scenes={scenes} starts={starts} />
      <ChapterProgress scenes={scenes} starts={starts} />
    </Stage>
  );
}

function FilmHeader({ scenes, starts }: { scenes: Placed[]; starts: number[] }) {
  const frame = useCurrentFrame();
  let k = 0;
  while (k + 1 < starts.length && starts[k + 1] <= frame) k++;
  const c = scenes[k].chapter;
  const title = timeline.chapters[c].title;
  const { vertical, pad } = useLayout();
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: vertical ? 186 : 48, left: pad.left, right: pad.right, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ opacity: k === 0 ? 0 : 1 }}><Logo size={46} /></div>
        {c > 0 ? (
          <div style={{ padding: '10px 18px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: C.muted2, fontSize: 20, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

function ChapterProgress({ scenes, starts }: { scenes: Placed[]; starts: number[] }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const ticks = scenes.map((s, k) => (k === 0 || s.chapter !== scenes[k - 1].chapter ? starts[k] : -1)).filter((t) => t > 0);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 8, background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ position: 'absolute', left: 0, bottom: 0, height: 8, width: `${(frame / durationInFrames) * 100}%`, background: C.lime }} />
      {ticks.map((t) => <div key={t} style={{ position: 'absolute', bottom: 0, left: `${(t / durationInFrames) * 100}%`, width: 3, height: 8, background: C.ink }} />)}
    </AbsoluteFill>
  );
}

// Exported so the scene list can be checked without rendering the film.
export { chapters as filmChapters };
