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

/** "Valid until 00:42 tonight" — the phrasing the design uses on the code card. */
export function validUntil(expiresAt: string): string {
  const d = parse(expiresAt);
  if (!d) return 'Valid for 6 hours';
  const sameDay = d.toDateString() === new Date().toDateString();
  return `Valid until ${clock(expiresAt)}${sameDay ? ' tonight' : ''}`;
}

/** "Made 18:42", or a date once it is no longer today. */
export function madeAt(iso: string): string {
  const d = parse(iso);
  if (!d) return '';
  if (d.toDateString() === new Date().toDateString()) return `Made ${clock(iso)}`;
  return `Made ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${clock(iso)}`;
}

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
  return note ? `${base}\n\nDelivery instructions: ${note}` : base;
}
