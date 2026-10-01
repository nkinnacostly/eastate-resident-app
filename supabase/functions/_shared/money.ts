/**
 * Money formatting for Edge Functions.
 *
 * Deliberately a copy of formatMoney in packages/core rather than an import.
 * Edge Functions are Deno and the workspace package is resolved by Node's
 * module system; reaching across that boundary works until the day a bundler
 * setting changes and an email silently fails to render. Fifteen lines of
 * duplication is the cheaper risk, and the two are covered by the same test.
 *
 * Amounts are integer minor units (kobo, cents) everywhere and divided only
 * for display. Never the reverse: 0.1 + 0.2 is not 0.3 in binary floating
 * point, and money that does not add up is money nobody trusts.
 */
export function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat(currency === 'ZAR' ? 'en-ZA' : 'en-NG', {
      style: 'currency',
      currency,
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    }).format(major);
  } catch {
    // An unknown currency code must not stop a reminder going out.
    return `${currency} ${major.toLocaleString()}`;
  }
}

/** The terms a payer can pick. Mirrors the CHECK on dues_payments.months. */
export const DUES_TERMS = [1, 3, 6, 12] as const;

/**
 * Read `months` from a request body. Anything that is not a supported term
 * becomes null and the caller refuses it -- never silently 1, or a typo in a
 * client would quietly charge one month for what the payer chose as a year.
 */
export function parseTerm(raw: unknown): number | null {
  if (raw === undefined || raw === null) return 1;
  const n = Number(raw);
  return (DUES_TERMS as readonly number[]).includes(n) ? n : null;
}

/** "Jan 2027" -- for the line the payer sees on the checkout page. */
function monthLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** "Monthly estate dues" or "Estate dues, 3 months (Jan 2027 – Mar 2027)". */
export function termDescription(months: number, from: string | null, until: string | null): string {
  if (months <= 1 || !from || !until) return 'Monthly estate dues';
  return `Estate dues, ${months} months (${monthLabel(from)} – ${monthLabel(until)})`;
}
