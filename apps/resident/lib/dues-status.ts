import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { listMyDues, myDuesSummary, type DuesCharge, type DuesSummary } from './api';

/**
 * What the resident owes, and whether it stops them making codes.
 *
 * Exists because of a real dead end. A resident with overdue dues pressed
 * Generate and got "Could not generate a code. Please try again." Trying again
 * could never have worked, and nothing on the screen beforehand said a penny
 * was owed. The refusal was correct; the silence around it was not.
 *
 * The fix is to stop treating arrears as an error discovered at the moment of
 * failure, and start treating it as state the home screen already knows.
 */
export interface DuesStatus {
  /**
   * The server's own view. Present even when there are no charges at all,
   * which is exactly when a list-derived status would wrongly read as "owes
   * nothing".
   */
  summary: DuesSummary | null;
  /** Every charge the resident can see, newest first. */
  all: DuesCharge[];
  /** Paid and waived months — the Dues tab's History section. */
  settled: DuesCharge[];
  /** Open charges past their due date. */
  overdue: DuesCharge[];
  /** Everything still unpaid, overdue or not. */
  outstanding: DuesCharge[];
  totalOwedMinor: number;
  currency: string;
  /**
   * True only when arrears ACTUALLY stop this resident minting: overdue AND
   * the estate has authorised enforcement. The distinction is the whole point
   * -- an estate may bill dues and restrict nobody.
   */
  blocked: boolean;
  /** Owes something overdue, but this estate does not withhold codes for it. */
  owesButNotBlocked: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useDuesStatus(estateId: string | null): DuesStatus {
  const [rows, setRows] = useState<DuesCharge[]>([]);
  const [summary, setSummary] = useState<DuesSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!estateId) {
      setRows([]);
      setSummary(null);
      return;
    }
    setLoading(true);
    try {
      // One round trip each, in parallel. The summary is authoritative for
      // "am I blocked"; the list is what the screen renders.
      const [s, r] = await Promise.all([myDuesSummary(estateId), listMyDues(estateId)]);
      setSummary(s);
      setRows(r);
    } catch {
      // Deliberately silent. This drives a banner, not a screen: an estate
      // with no dues configured, or a network blip, must not raise an alert
      // over something the resident did not ask for. The generate path still
      // reports its own failure.
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [estateId]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const outstanding = rows.filter((r) => r.status === 'open');
  const overdue = outstanding.filter((r) => r.is_overdue);

  // Preferred over anything derived from the list: the summary is computed by
  // the same database that the gate consults, so the banner and the Generate
  // button cannot disagree.
  const blocked = summary?.blocked ?? false;
  const owesSomethingLate = (summary?.overdue_count ?? overdue.length) > 0;

  return {
    summary,
    all: rows,
    settled: rows.filter((r) => r.status === 'paid' || r.status === 'waived'),
    overdue,
    outstanding,
    totalOwedMinor: Number(summary?.outstanding_minor ?? 0)
      || outstanding.reduce((n, r) => n + Number(r.amount_minor), 0),
    currency: summary?.currency ?? outstanding[0]?.currency ?? rows[0]?.currency ?? 'NGN',
    blocked,
    owesButNotBlocked: owesSomethingLate && !blocked,
    loading,
    refresh,
  };
}
