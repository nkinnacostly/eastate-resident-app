import { verifyOffline, verifyOnline, type Verdict } from './verify';

/**
 * The server's answer when the person signed in is no longer a guard here --
 * removed from the gate on the dashboard (deactivate_membership).
 */
const NOT_A_GUARD_HERE = 'not_a_guard_at_this_estate';

/**
 * Thrown instead of falling back to the pool when the server says this guard
 * has been removed. Callers re-resolve the post (recheckPost), which finds no
 * active membership, clears the codes off this phone and leaves the keypad.
 */
export class NoLongerOnPostError extends Error {
  constructor() {
    super('You are no longer a guard at this estate, so this phone cannot check codes. Ask the estate admin.');
    this.name = 'NoLongerOnPostError';
  }
}

/**
 * One code in, one verdict out -- the decision the keypad and the QR scanner
 * share.
 *
 * They are two ways of getting six characters into the app, and this is the
 * only place that decides what to do with them. It lives outside both screens
 * so a scanned code cannot take a different path from a typed one: a scan with
 * no signal goes to the pool on this phone exactly as typing does, and burns
 * the code there just the same.
 *
 * Online verdicts are authoritative; offline ones are provisional and say so on
 * the verdict screen. Which one to ask is decided from the network state up
 * front rather than by catching a network error, so a slow gate does not
 * double-burn a code. If the server was reachable a moment ago and is not now,
 * fall back to the pool rather than make the guard start again -- the visitor
 * is waiting. Throws only when that fails too, with the server's error, since
 * that is the one the guard can act on.
 *
 * Except when the server's error IS the answer. "Not a guard at this estate"
 * means the estate removed this person, and the pool must not stand in for a
 * server that has just said no: that fallback is what let a removed guard's
 * phone go on showing "Let them in -- checked on this phone" until its next
 * token refresh, up to an hour later.
 */
export async function checkCode(
  estateId: string,
  code: string,
  online: boolean,
): Promise<Verdict> {
  if (!online) return verifyOffline(code);
  try {
    return await verifyOnline(estateId, code);
  } catch (serverError) {
    if ((serverError as Error).message?.includes(NOT_A_GUARD_HERE)) throw new NoLongerOnPostError();
    try {
      return await verifyOffline(code);
    } catch {
      throw serverError;
    }
  }
}
