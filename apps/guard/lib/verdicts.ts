import * as Crypto from 'expo-crypto';

import type { Verdict } from './verify';

/**
 * Where a verdict waits between the keypad and the verdict screen.
 *
 * It used to travel IN the route, as `/verdict?v=<json>`, and the screen
 * rendered whatever JSON it was handed. The app exports the `estateguard`
 * scheme, so that made the most trusted screen in the app a template anyone
 * could fill in: a visitor sends the guard `estateguard://verdict?v=` with
 * `"decision":"admit","checkedWith":"server"` in it, the guard taps it, and the
 * phone shows a lime "Let them in -- CHECKED WITH THE SERVER" that no server
 * ever said. Nothing was burned and nothing was logged, because nothing ran.
 *
 * So the route now carries only an opaque id, and the verdict itself never
 * leaves this process. A link can name an id but cannot put a verdict behind
 * it: the only writer is this module, and the only callers are the screens
 * that just ran verifyOnline / verifyOffline / admitAndFlag. An unknown id is
 * the screen's existing "No verdict to show" state.
 *
 * In memory on purpose. A verdict is an answer for the visitor standing at the
 * gate right now; it has no business surviving a restart, and writing it to
 * disk would only create a second place to forge one.
 */

/**
 * Bounded because not every exit goes through forget(): Android's back button
 * pops the verdict screen without pressing anything. A guard checks one visitor
 * at a time, so a handful is already more history than anything reads.
 */
const MAX_HELD = 10;

const held = new Map<string, Verdict>();

/** Hold a verdict that was just produced, and get the id to navigate with. */
export function holdVerdict(verdict: Verdict): string {
  // Random rather than the verdict's clientEventId: that id is sent to the
  // server and shown in the admin's log, so it is not a secret, and the point
  // of this one is that nobody outside the process can know it.
  const id = Crypto.randomUUID();
  held.set(id, verdict);
  // Map iterates in insertion order, so the first key is the oldest.
  while (held.size > MAX_HELD) {
    const oldest = held.keys().next().value;
    if (oldest === undefined) break;
    held.delete(oldest);
  }
  return id;
}

/** Null for anything this process did not produce -- including every forged id. */
export function readVerdict(id: string | null | undefined): Verdict | null {
  if (typeof id !== 'string') return null;
  return held.get(id) ?? null;
}

/**
 * Swap the verdict behind an id the screen is already showing.
 *
 * Used by the admit-and-flag override, so a screen that remounts shows the
 * flagged entry the guard committed to -- not the refusal again, inviting a
 * second override and a second flagged event for the same visitor.
 */
export function replaceVerdict(id: string, verdict: Verdict): void {
  if (held.has(id)) held.set(id, verdict);
}

/** Drop a verdict once the guard has moved on to the next visitor. */
export function forgetVerdict(id: string | null | undefined): void {
  if (typeof id === 'string') held.delete(id);
}

/** Test seam -- lets a suite start from an empty store. */
export function __resetVerdictsForTests() {
  held.clear();
}
