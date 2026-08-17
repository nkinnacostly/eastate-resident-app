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

export interface AdminMembership {
  id: string;
  estate_id: string;
  estate_name: string;
  join_code: string;
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  /** Estates where this user is an ACTIVE ADMIN. Empty for everyone else. */
  estates: AdminMembership[];
  estatesLoaded: boolean;
  activeEstateId: string | null;
  setActiveEstateId: (id: string) => void;
  activeEstate: AdminMembership | null;
  refreshEstates: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** True for a platform owner. Resolved per session, never from a JWT claim. */
  isPlatformAdmin: boolean;
  /**
   * False until the ownership check has answered once.
   *
   * The gate must not route on `isPlatformAdmin` before this: it starts false,
   * and an owner who also administers an estate would be sent to the estate
   * dashboard for the split second before the answer lands — long enough for a
   * catch-all route to rewrite the URL and strip the path they asked for.
   */
  rolesLoaded: boolean;
  /**
   * Set on an account whose password was generated during estate onboarding and
   * read aloud to somebody. Cleared once they choose their own.
   */
  mustChangePassword: boolean;
  changePassword: (next: string) => Promise<{ error: string | null }>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [estates, setEstates] = useState<AdminMembership[]>([]);
  const [estatesLoaded, setEstatesLoaded] = useState(false);
  const [activeEstateId, setActiveEstateId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [rolesLoaded, setRolesLoaded] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Keyed on the user id, never the session object — an object identity that
  // changes per render would turn this into a request loop.
  const userId = session?.user.id ?? null;

  const refreshEstates = useCallback(async () => {
    if (!userId) {
      setEstates([]);
      setActiveEstateId(null);
      setEstatesLoaded(true);
      return;
    }

    // Admin memberships only, and only THIS user's.
    //
    // The user_id filter is not redundant: the memberships policy has an
    // `or is_platform_admin()` arm, so for a platform owner this query would
    // otherwise return every admin membership on the platform and the owner
    // would appear to administer every estate — including a route into resident
    // names, which the operator dashboard states they cannot see. RLS decides
    // the ceiling; the query still has to ask for the right thing.
    const { data, error } = await supabase
      .from('memberships')
      .select('id, estate_id, estates(name, join_code)')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .eq('is_active', true);

    if (error) {
      console.warn('[auth] estate lookup failed:', error.message);
      setEstates([]);
      return; // not proof of "no estates" — leave estatesLoaded alone
    }

    const rows: AdminMembership[] = (data ?? []).map((m) => {
      const e = m.estates as { name: string; join_code: string } | null;
      return {
        id: m.id,
        estate_id: m.estate_id,
        estate_name: e?.name ?? 'Unknown estate',
        join_code: e?.join_code ?? '',
      };
    });

    setEstates(rows);
    setActiveEstateId((cur) => cur ?? rows[0]?.estate_id ?? null);
    setEstatesLoaded(true);
  }, [userId]);

  useEffect(() => {
    setEstatesLoaded(false);
    void refreshEstates();
  }, [refreshEstates]);

  // Resolved alongside the memberships and for the same reason: a role carried
  // in a JWT claim goes stale exactly where staleness is dangerous — a revoked
  // platform admin would keep the operator dashboard until their token
  // refreshed.
  useEffect(() => {
    if (!userId) {
      setIsPlatformAdmin(false);
      setMustChangePassword(false);
      setRolesLoaded(true);
      return;
    }
    setRolesLoaded(false);
    let live = true;
    void (async () => {
      const [owner, profile] = await Promise.all([
        supabase.rpc('is_platform_admin'),
        supabase.from('profiles').select('must_change_password').eq('id', userId).single(),
      ]);
      if (!live) return;
      if (owner.error) console.warn('[auth] ownership check failed:', owner.error.message);
      else setIsPlatformAdmin(Boolean(owner.data));
      if (!profile.error) setMustChangePassword(Boolean(profile.data?.must_change_password));
      // Marked loaded even on error. Leaving it false would hold the app on a
      // blank screen forever; proceeding treats a failed check as "not an
      // owner", which shows a screen with a way out rather than nothing.
      setRolesLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [userId]);

  const changePassword = useCallback(async (next: string) => {
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) return { error: error.message };
    // Only after the password actually changed. The flag is not clearable by
    // writing the column — column-level grants see to that (20260815180000).
    const { error: clearErr } = await supabase.rpc('clear_must_change_password');
    if (clearErr) return { error: clearErr.message };
    setMustChangePassword(false);
    return { error: null };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const activeEstate = useMemo(
    () => estates.find((e) => e.estate_id === activeEstateId) ?? null,
    [estates, activeEstateId],
  );

  const value = useMemo<AuthState>(
    () => ({
      session, loading, estates, estatesLoaded, activeEstateId,
      setActiveEstateId, activeEstate, refreshEstates, signIn, signOut,
      isPlatformAdmin, rolesLoaded, mustChangePassword, changePassword,
    }),
    [
      session, loading, estates, estatesLoaded, activeEstateId,
      activeEstate, refreshEstates, signIn, signOut,
      isPlatformAdmin, rolesLoaded, mustChangePassword, changePassword,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
