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
  /**
   * Set by an estate admin when granting membership, so it is null between
   * sign-up and approval. Per-membership, not per-user: the same person can
   * hold different units at different estates.
   */
  unit: string | null;
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
  signUp: (input: SignUpInput) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  /**
   * The unit the applicant claims, captured for whoever approves them. It is
   * stored as `requested_unit` in user_metadata and is NOT authoritative — the
   * real value is `memberships.unit`, which only an estate admin can set.
   */
  unit: string;
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
        .select('id, estate_id, role, unit, estates(name)')
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
        unit: m.unit,
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

  const signUp = useCallback(async (input: SignUpInput) => {
    const { error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        // `unit` here is the unit the applicant CLAIMS, kept so the admin has
        // something to check against when approving. The authoritative value is
        // memberships.unit, which only an admin can set — never read this one
        // back as if it were confirmed.
        data: { full_name: input.fullName, phone: input.phone, requested_unit: input.unit },
      },
    });
    // Signing up creates the account only. Access to an estate comes from a
    // membership, which an admin grants — so a new user lands signed in with
    // zero memberships and cannot mint anything yet. That is intended (PRD §7).
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
      signUp,
      signOut,
    }),
    [session, memberships, activeEstateId, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
