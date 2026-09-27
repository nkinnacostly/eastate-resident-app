import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { myAgencies, type Agency } from './agency';
import { Ctx, type AdminMembership, type AuthState } from './auth-context';
import { supabase } from './supabase';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [estates, setEstates] = useState<AdminMembership[]>([]);
  const [estatesLoaded, setEstatesLoaded] = useState(false);
  const [estatesError, setEstatesError] = useState<string | null>(null);
  const [activeEstateId, setActiveEstateId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [agenciesLoaded, setAgenciesLoaded] = useState(false);

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
      // The constraint is NAMED rather than left to PostgREST to infer.
      //
      // `estates(...)` used to be enough. It stopped being enough the moment a
      // second foreign key existed between these two tables -- an audit column
      // on estates pointing back at memberships -- at which point PostgREST
      // refused to choose and answered 300 PGRST201, logging every admin,
      // resident and guard out at once. Naming it means a future key cannot do
      // that again. supabase/tests/embeds.sql guards the whole class.
      .select('id, estate_id, estates!memberships_estate_id_fkey(name, join_code)')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .eq('is_active', true);

    if (error) {
      console.warn('[auth] estate lookup failed:', error.message);
      setEstates([]);
      // Still not proof of "no estates", so estatesLoaded stays false and the
      // person is not booted to a "you have no access" screen over a network
      // blip. But the failure IS recorded, because the gate cannot otherwise
      // distinguish a slow answer from one that will never come -- and when it
      // could not, a permanently failing query left the app on a blank screen
      // with nothing to press.
      setEstatesError(error.message);
      return;
    }
    setEstatesError(null);

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

  useEffect(() => {
    if (!userId) {
      setAgencies([]);
      setAgenciesLoaded(true);
      return;
    }
    setAgenciesLoaded(false);
    let live = true;
    void (async () => {
      try {
        const rows = await myAgencies();
        if (live) setAgencies(rows.filter((a) => a.role === 'admin'));
      } catch (e) {
        // Loaded-on-error, matching the ownership check below: holding the app
        // on a blank screen is worse than treating a failed lookup as "no
        // agencies", which lands somewhere with a way out.
        console.warn('[auth] agency lookup failed:', (e as Error).message);
      } finally {
        if (live) setAgenciesLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [userId]);

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
      session, loading, estates, estatesLoaded, estatesError, activeEstateId,
      setActiveEstateId, activeEstate, refreshEstates, signIn, signOut,
      isPlatformAdmin, rolesLoaded, mustChangePassword, changePassword,
      agencies, agenciesLoaded,
    }),
    [
      session, loading, estates, estatesLoaded, estatesError, activeEstateId,
      activeEstate, refreshEstates, signIn, signOut,
      isPlatformAdmin, rolesLoaded, mustChangePassword, changePassword,
      agencies, agenciesLoaded,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
