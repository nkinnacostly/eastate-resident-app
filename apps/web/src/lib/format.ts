/** Wall-clock time, e.g. "18:58". Empty on unparseable input rather than NaN. */
export function clock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function dayTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const today = d.toDateString() === new Date().toDateString();
  return today
    ? clock(iso)
    : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${clock(iso)}`;
}

/** Countdown for a live code. Cosmetic only — never the thing deciding validity. */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}

const REJECT: Record<string, string> = {
  unknown_code: 'no such code',
  expired: 'expired',
  already_used: 'already used',
  revoked: 'cancelled',
};

/** One human phrase for an event, so the log reads as sentences not enums. */
export function outcomeLabel(outcome: string, reason: string | null): string {
  if (outcome === 'admitted') return 'Admitted';
  if (outcome === 'collision') return 'Refused · already used elsewhere';
  if (outcome === 'rejected') {
    return reason ? `Refused · ${REJECT[reason] ?? reason}` : 'Refused';
  }
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

/**
 * "Thabo Nkosi" -> "TN". Lives here rather than in components/ui because it is
 * a string function, and exporting a non-component from a file full of
 * components breaks React Fast Refresh for every component in it.
 */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
