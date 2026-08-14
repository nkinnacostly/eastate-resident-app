import type { MintResult } from '@estate/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { listMyCodes, mintCode, type CodeRow } from './api';
import { useAuth } from './auth';

interface CodesState {
  codes: CodeRow[];
  live: CodeRow[];
  loading: boolean;
  refresh: () => Promise<void>;
  mint: () => Promise<MintResult | null>;
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

  const refresh = useCallback(async () => {
    if (!session) {
      setCodes([]);
      return;
    }
    setLoading(true);
    try {
      setCodes(await listMyCodes());
    } catch {
      // Leave the last known list in place; a transient network failure should
      // not blank out codes the resident may be reading aloud right now.
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mint = useCallback(async () => {
    if (!activeEstateId) return null;
    const res = await mintCode(activeEstateId);
    await refresh();
    return res;
  }, [activeEstateId, refresh]);

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
