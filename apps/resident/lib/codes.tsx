import type { MintResult } from '@estate/core';
import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { listMyCodes, mintCode, type CodeRow, type DeliveryDetails } from './api';
import { useAuth } from './auth';

interface CodesState {
  codes: CodeRow[];
  live: CodeRow[];
  loading: boolean;
  refresh: () => Promise<void>;
  mint: (delivery?: DeliveryDetails) => Promise<MintResult | null>;
}

const CodesContext = createContext<CodesState | null>(null);

/**
 * One source of codes for the whole tab group.
 *
 * Home, the Codes tab, History and the nav badge all read the same list — if
 * each fetched its own, the cap counter and the badge could disagree, which is
 * exactly the number a resident is trying to trust.
 */
export function CodesProvider({ children }: { children: ReactNode }) {
  const { session, activeEstateId } = useAuth();
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Keyed on the user ID, not the session OBJECT. `refresh` is a dependency of
  // both the focus effect and the foreground listener, so if its identity
  // changed on every render each fetch would trigger the next one — an
  // unbounded request loop against the database. A primitive cannot do that.
  const userId = session?.user.id ?? null;

  // Shares one request between overlapping callers. Mount, tab focus and
  // returning to the foreground can all fire at once — without this the app
  // issues three identical queries and the last to land wins, which is not
  // necessarily the freshest.
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setCodes([]);
      return;
    }
    if (inFlight.current) return inFlight.current;

    setLoading(true);
    const run = (async () => {
      try {
        setCodes(await listMyCodes());
      } catch {
        // Leave the last known list in place; a transient network failure should
        // not blank out codes the resident may be reading aloud right now.
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Refetch when the app comes back to the foreground.
   *
   * This is the case that actually bites: the resident forwards a code, pockets
   * the phone, a guard burns it at the gate, and the resident reopens the app.
   * Without this the list still says "live" — the app misreporting the one fact
   * it exists to tell them. Notifications (§6.1) are the real fix for a code
   * burned while the app is OPEN; this covers everything else.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const mint = useCallback(
    async (delivery?: DeliveryDetails) => {
      if (!activeEstateId) return null;
      const res = await mintCode(activeEstateId, delivery ?? { isDelivery: false });
      await refresh();
      return res;
    },
    [activeEstateId, refresh],
  );

  // Derived, never read off `status` — an 'active' row past expires_at is
  // expired (Technical Design §2.4).
  const live = useMemo(() => codes.filter((c) => c.status === 'live'), [codes]);

  const value = useMemo<CodesState>(
    () => ({ codes, live, loading, refresh, mint }),
    [codes, live, loading, refresh, mint],
  );

  return <CodesContext.Provider value={value}>{children}</CodesContext.Provider>;
}

export function useCodes(): CodesState {
  const ctx = useContext(CodesContext);
  if (!ctx) throw new Error('useCodes must be used inside <CodesProvider>');
  return ctx;
}

/**
 * Refetch whenever a screen is opened.
 *
 * Tab screens stay MOUNTED, so a mount-only effect never runs again — switching
 * tabs would show whatever the list held when the tab first rendered. The
 * provider cannot do this itself: it is not a screen, so it has no focus of its
 * own to react to.
 */
export function useCodesOnFocus(): CodesState {
  const codes = useCodes();
  const { refresh } = codes;
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  return codes;
}
