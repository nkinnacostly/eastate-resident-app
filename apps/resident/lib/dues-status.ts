import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { listMyDues, type DuesCharge } from './api';

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
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!estateId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      setRows(await listMyDues(estateId));
    } catch {
      // Deliberately silent. This drives a banner, not a screen: an estate
      // with no dues configured, or a network blip, must not raise an alert
      // over something the resident did not ask for. The generate path still
      // reports its own failure.
      setRows([]);
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
  const enforcing = rows.some((r) => r.enforcement_on);

  return {
    overdue,
    outstanding,
    totalOwedMinor: outstanding.reduce((n, r) => n + Number(r.amount_minor), 0),
    currency: outstanding[0]?.currency ?? rows[0]?.currency ?? 'NGN',
    blocked: overdue.length > 0 && enforcing,
    owesButNotBlocked: overdue.length > 0 && !enforcing,
    loading,
    refresh,
  };
}
