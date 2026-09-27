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
