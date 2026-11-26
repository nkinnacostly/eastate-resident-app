import { formatMoney } from '@estate/core';

/**
 * Shared by the operator's and the estate admin's payment ledgers. A separate
 * file from components/dues-transactions.tsx because exporting non-components
 * from a component file breaks React Fast Refresh for every component in it.
 */

/** Matches the RPCs' default p_limit. */
export const TRANSACTION_CAP = 2000;

export const WINDOWS = ['30 days', '90 days', '12 months', 'All time'] as const;
export type Window = (typeof WINDOWS)[number];
const WINDOW_DAYS: Record<Window, number | null> = {
  '30 days': 30, '90 days': 90, '12 months': 365, 'All time': null,
};

export function sinceFor(w: Window): string | null {
  const days = WINDOW_DAYS[w];
  return days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Sum per currency and print each — an NGN and a ZAR figure added together is not a number. */
export function byCurrency<T extends { currency: string }>(rows: T[], pick: (r: T) => number): string {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.currency, (sums.get(r.currency) ?? 0) + pick(r));
  if (sums.size === 0) return formatMoney(0, 'NGN');
  return [...sums].map(([c, n]) => formatMoney(n, c)).join(' · ');
}
