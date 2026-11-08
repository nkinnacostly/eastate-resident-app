import { verifyOffline, verifyOnline, type Verdict } from './verify';

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
    try {
      return await verifyOffline(code);
    } catch {
      throw serverError;
    }
  }
}
