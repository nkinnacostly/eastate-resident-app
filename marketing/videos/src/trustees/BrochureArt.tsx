/**
 * Still images for the image-led trustees' brochure, rendered from the same
 * screens as the film (render with scripts in marketing/brochure). Each one
 * is a transparent PNG: phones and windows with their own shadows, no stage.
 *
 * Rendered at a late frame (FRAME) so every spring, typing animation and
 * slide-in has finished.
 */
import type { ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';

import { Phone } from '../phone';
import { DuesSetupPage, GuardsPage, OverviewPage, Spreadsheet } from './desk';
import {
  DuesTab, GuardVerdict, Home, Keypad, Pass, Push, ScanScreen, SendSheet, SignUp, VisitorChat,
} from './screens';

/** The brochure is for one estate, so its screens carry that estate's name. */
export const BROCHURE_ESTATE = 'Drakenzicht Estate';

export const FRAME = 230;

const Center = ({ children }: { children: ReactNode }) => (
  <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>{children}</AbsoluteFill>
);

const One = ({ children }: { children: ReactNode }) => (
  <Center><Phone>{children}</Phone></Center>
);

/** Two phones overlapping, the second in front, tilted apart. */
const Duo = ({ back, front }: { back: ReactNode; front: ReactNode }) => (
  <AbsoluteFill>
    <div style={{ position: 'absolute', left: 70, top: 90, transform: 'rotate(-7deg)' }}><Phone>{back}</Phone></div>
    <div style={{ position: 'absolute', left: 470, top: 60, transform: 'rotate(5deg)' }}><Phone>{front}</Phone></div>
  </AbsoluteFill>
);

const HomeArrived = () => (
  <div style={{ position: 'absolute', inset: 0 }}>
    <Home live={0} />
    <Push at={0} title="Your visitor has arrived" body="Code K7Q2MX was used at the gate." />
  </div>
);

export const ART: { id: string; width: number; height: number; el: ReactNode }[] = [
  { id: 'hero', width: 1000, height: 1080, el: <Duo back={<Pass />} front={<GuardVerdict ok at={0} />} /> },
  { id: 'step-create', width: 600, height: 1060, el: <One><Home live={1} /></One> },
  { id: 'step-send', width: 600, height: 1060, el: <One><SendSheet at={0} pick="qr" /></One> },
  { id: 'step-visitor', width: 600, height: 1060, el: <One><VisitorChat at={0} /></One> },
  { id: 'step-scan', width: 600, height: 1060, el: <One><ScanScreen at={0} /></One> },
  { id: 'step-told', width: 600, height: 1060, el: <One><HomeArrived /></One> },
  { id: 'offline', width: 1000, height: 1080, el: <Duo back={<Keypad offline from={0} to={60} />} front={<GuardVerdict ok offline at={0} />} /> },
  { id: 'dashboard', width: 1260, height: 880, el: <Center><OverviewPage /></Center> },
  { id: 'dues', width: 600, height: 1060, el: <One><DuesTab pickAt={40} /></One> },
  { id: 'payout', width: 1260, height: 880, el: <Center><DuesSetupPage stage="account" at={0} /></Center> },
  { id: 'sheet', width: 1120, height: 480, el: <Center><Spreadsheet /></Center> },
  { id: 'guards', width: 1260, height: 880, el: <Center><GuardsPage pressAt={70} /></Center> },
  { id: 'signup', width: 600, height: 1060, el: <One><SignUp from={0} /></One> },
];
