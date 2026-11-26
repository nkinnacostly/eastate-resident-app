/** Presentation helpers. Nothing here decides validity — that is always the server. */

/**
 * "5h 12m" / "24m" / "Expired".
 *
 * Cosmetic only: the countdown reaching zero does not make a code invalid, and
 * a code is not valid merely because this still shows time. Expiry is decided
 * by `expires_at` at verification (Technical Design §2.4).
 */
/** Guards every formatter below: a bad timestamp must not render "Invalid Date". */
function parse(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function timeLeft(expiresAt: string, now: number = Date.now()): string {
  const d = parse(expiresAt);
  if (!d) return '';
  const ms = d.getTime() - now;
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "18:42" in the device's locale/timezone. */
export function clock(iso: string): string {
  const d = parse(iso);
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

/**
 * "Valid until 21:42 tonight", "Valid until 14:00 today", "Valid until 02:15
 * tomorrow" -- the code card's phrasing, and the line the visitor reads.
 *
 * "Tonight" only from 18:00. It used to be added to any expiry on the same
 * day, so a code made at 08:00 told the visitor it was "valid until 14:00
 * tonight". A code lives six hours, so the expiry is always today or
 * tomorrow.
 */
export function validUntil(expiresAt: string): string {
  const d = parse(expiresAt);
  if (!d) return 'Valid for 6 hours';
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const when =
    d.toDateString() === now.toDateString()
      ? d.getHours() >= 18
        ? ' tonight'
        : ' today'
      : d.toDateString() === tomorrow.toDateString()
        ? ' tomorrow'
        : '';
  return `Valid until ${clock(expiresAt)}${when}`;
}

/** "Made 18:42", or a date once it is no longer today. */
export function madeAt(iso: string): string {
  const d = parse(iso);
  if (!d) return '';
  if (d.toDateString() === new Date().toDateString()) return `Made ${clock(iso)}`;
  return `Made ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${clock(iso)}`;
}

/**
 * Where a visitor can read what the gate records about them.
 *
 * A visitor has no account and no contract with the estate, so they never pass
 * through a screen we control -- this forwarded message is the ONLY moment we
 * can reach them before they arrive. South Africa's draft Residential
 * Communities code says so directly: the privacy notice "should be made
 * available via a link in the Visitor Management System so that visitors are
 * able to read it prior to visiting the estate through the message they
 * receive".
 *
 * Kept last and on its own line so it never competes with the code.
 */
export const PRIVACY_URL = 'https://myestateaccess.com/privacy';

/**
 * The message a resident forwards. Carries the estate so it makes sense alone.
 *
 * A delivery note is appended on its own line rather than inlined: the rider is
 * reading this on a phone while holding a parcel, and the code is the part they
 * need to find at a glance. Burying it mid-sentence behind instructions is how
 * a driver ends up phoning to ask what the code was.
 */
export function shareMessage(
  code: string,
  estate: string,
  expiresAt: string,
  deliveryNote?: string | null,
): string {
  const base = `Your code for ${estate} is ${code}. ${validUntil(expiresAt)}.`;
  const note = deliveryNote?.trim();
  const body = note ? `${base}\n\nDelivery instructions: ${note}` : base;
  return `${body}\n\nWhat the gate records: ${PRIVACY_URL}`;
}
