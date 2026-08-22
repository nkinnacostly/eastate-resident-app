import type { MembershipRole } from '@estate/core';
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { requestHouseAccess, type JoinResult } from './api';
import { supabase } from './supabase';

export interface Membership {
  id: string;
  estate_id: string;
  role: MembershipRole;
  estate_name: string;
  /** The house this resident lives in. Null only for pre-houses rows. */
  house_number: string | null;
  /**
   * The house's own join code. Shown to the resident so they can pass it to a
   * housemate — several people share one house, each on their own phone, and
   * this is how the second one gets in.
   */
  house_code: string | null;
}

interface AuthState {
  session: Session | null;
  /** Active resident memberships. One human can live at more than one estate. */
  memberships: Membership[];
  /** The estate the app is currently acting as. Null until memberships load. */
  activeEstateId: string | null;
  setActiveEstateId: (estateId: string) => void;
  loading: boolean;
  /**
   * False until the membership query has answered at least once. The gate needs
   * this to tell "no estate yet" apart from "not looked yet" — without it a
   * signed-in resident is bounced to the join screen on every cold start,
   * before their membership has loaded.
   */
  membershipsLoaded: boolean;
  refreshMemberships: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (input: SignUpInput) => Promise<SignUpOutcome>;
  signOut: () => Promise<void>;
  /**
   * Erases the account for good — required in-app by App Store guideline
   * 5.1.1(v) and Google Play's account deletion policy, neither of which
   * accepts deactivation or a "contact support" flow.
   */
  deleteAccount: () => Promise<DeleteAccountResult>;
  /**
   * How the join request made during sign-up landed, handed to the join screen.
   *
   * It travels through here rather than through that screen's own state because
   * the gate redirects to /join the instant the session appears — before the
   * sign-up screen can render anything. Consumed once, so a later visit to
   * /join doesn't replay a stale "code not recognised".
   */
  takeSignUpJoinResult: () => JoinResult | null;
}

/** Outcome of a self-service account deletion. */
export type DeleteAccountResult =
  | { status: 'deleted' }
  | { status: 'error'; message: string };

export interface SignUpInput {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  /** The estate's join code. Half of what places this person in a house. */
  estateCode: string;
  /** The house's own code, from their landlord. Only unique within the estate. */
  houseCode: string;
}

/**
 * What came of a sign-up.
 *
 * Three outcomes rather than an error string, because the account and the join
 * request are two separate things that fail separately: the account can be
 * created and the codes still be wrong.
 */
export type SignUpOutcome =
  /** The account was not created. Nothing was sent. */
  | { status: 'error'; message: string }
  /** Account created and the join request submitted — `join` says how it landed. */
  | { status: 'requested'; join: JoinResult }
  /** Account created, but no session yet (email confirmation is on), so the
   *  request could not be made under their identity. They finish at /join. */
  | { status: 'confirm_email' };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeEstateId, setActiveEstateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);
  // A ref, not state: this is a one-shot handoff to the next screen, and
  // re-rendering everything under the provider to deliver it would be noise.
  const signUpJoin = useRef<JoinResult | null>(null);

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
  // Keyed on the user id rather than the session object, so a new session
  // identity for the same user cannot retrigger the query in a loop.
  const userId = session?.user.id ?? null;

  const refreshMemberships = useCallback(async () => {
    if (!userId) {
      setMemberships([]);
      setActiveEstateId(null);
      setMembershipsLoaded(true);
      return;
    }

    // RLS scopes this to the caller's own rows — no client-side filter needed.
    const { data, error } = await supabase
      .from('memberships')
      .select('id, estate_id, role, estates(name), houses(house_number, house_code)')
      .eq('role', 'resident')
      .eq('is_active', true);

    if (error) {
      console.warn('[auth] membership lookup failed:', error.message);
      // Deliberately NOT setting membershipsLoaded here: a failed lookup is not
      // evidence the resident has no estate, and treating it as such would boot
      // them to the join screen every time the network hiccups.
      setMemberships([]);
      return;
    }

    const rows: Membership[] = (data ?? []).map((m) => ({
      id: m.id,
      estate_id: m.estate_id,
      role: m.role,
      estate_name: (m.estates as { name: string } | null)?.name ?? 'Unknown estate',
      house_number: (m.houses as { house_number: string } | null)?.house_number ?? null,
      house_code: (m.houses as { house_code: string } | null)?.house_code ?? null,
    }));

    setMemberships(rows);
    setActiveEstateId((current) => current ?? rows[0]?.estate_id ?? null);
    setMembershipsLoaded(true);
  }, [userId]);

  useEffect(() => {
    setMembershipsLoaded(false);
    void refreshMemberships();
  }, [refreshMemberships]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (input: SignUpInput): Promise<SignUpOutcome> => {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        // Name and phone only. The address is NOT taken from here — it comes
        // from the house the codes resolve to, which is a fact the estate owns
        // rather than a claim the applicant types.
        data: { full_name: input.fullName, phone: input.phone },
      },
    });
    if (error) return { status: 'error', message: error.message };

    // request_house_access derives the applicant from auth.uid(), so it needs a
    // session. signUp returns one only when email confirmation is off; with it
    // on there is nobody to make the request AS yet.
    if (!data.session) return { status: 'confirm_email' };

    const join = await requestHouseAccess(input.estateCode, input.houseCode);
    signUpJoin.current = join;

    // Signing up creates the account and asks to join. Access itself comes from
    // a MEMBERSHIP, which only an admin grants — so a new user lands signed in
    // with zero memberships and cannot mint anything yet. That is intended
    // (PRD §7), and it is why the gate sends them to /join next.
    return { status: 'requested', join };
  }, []);

  const takeSignUpJoinResult = useCallback(() => {
    const v = signUpJoin.current;
    signUpJoin.current = null;
    return v;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  /**
   * Deleting the auth user needs the service role, which must never ship in a
   * client, so the work happens in the delete-account Edge Function. The token
   * is read fresh rather than from `session` state: this is the one call where
   * acting on a stale token would leave the account half-deleted.
   */
  const deleteAccount = useCallback(async (): Promise<DeleteAccountResult> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { status: 'error', message: 'You are not signed in.' };

    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: {
          apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.deleted) {
        // The account is gone; clearing the local session is what returns the
        // app to the sign-in screen.
        await supabase.auth.signOut();
        return { status: 'deleted' };
      }
      return {
        status: 'error',
        message: body?.message ?? 'Your account could not be deleted. Please try again.',
      };
    } catch {
      return { status: 'error', message: 'No connection. Try again once you are back online.' };
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      memberships,
      activeEstateId,
      setActiveEstateId,
      loading,
      membershipsLoaded,
      refreshMemberships,
      signIn,
      signUp,
      signOut,
      deleteAccount,
      takeSignUpJoinResult,
    }),
    [
      session, memberships, activeEstateId, loading, membershipsLoaded,
      refreshMemberships, signIn, signUp, signOut, deleteAccount, takeSignUpJoinResult,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
