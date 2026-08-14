import type { MembershipRole } from '@estate/core';
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { supabase } from './supabase';

export interface Membership {
  id: string;
  estate_id: string;
  role: MembershipRole;
  estate_name: string;
}

interface AuthState {
  session: Session | null;
  /** Active resident memberships. One human can live at more than one estate. */
  memberships: Membership[];
  /** The estate the app is currently acting as. Null until memberships load. */
  activeEstateId: string | null;
  setActiveEstateId: (estateId: string) => void;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeEstateId, setActiveEstateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Memberships are resolved per-session rather than read from a JWT claim.
  // A claim would go stale: a membership deactivated mid-session would keep
  // working until the token refreshed (Technical Design §7).
  useEffect(() => {
    if (!session) {
      setMemberships([]);
      setActiveEstateId(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      // RLS scopes this to the caller's own rows — no client-side filter needed.
      const { data, error } = await supabase
        .from('memberships')
        .select('id, estate_id, role, estates(name)')
        .eq('role', 'resident')
        .eq('is_active', true);

      if (cancelled) return;
      if (error) {
        console.warn('[auth] membership lookup failed:', error.message);
        setMemberships([]);
        return;
      }

      const rows: Membership[] = (data ?? []).map((m) => ({
        id: m.id,
        estate_id: m.estate_id,
        role: m.role,
        estate_name: (m.estates as { name: string } | null)?.name ?? 'Unknown estate',
      }));

      setMemberships(rows);
      setActiveEstateId((current) => current ?? rows[0]?.estate_id ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      memberships,
      activeEstateId,
      setActiveEstateId,
      loading,
      signIn,
      signOut,
    }),
    [session, memberships, activeEstateId, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
