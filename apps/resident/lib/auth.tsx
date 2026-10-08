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
   * Ask for a reset code by email.
   *
   * Deliberately returns nothing but "the request was made". The endpoint
   * behind it answers identically for an address with an account and one
   * without, so there is no outcome here to branch on — reporting "no such
   * account" would turn the screen into a membership oracle for anyone who
   * wanted to know who lives on the estate.
   */
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  /**
   * Redeem the code and set the new password, as one step.
   *
   * One step because redeeming a recovery code SIGNS THE USER IN, and the gate
   * in app/_layout unmounts the whole (auth) group the moment a session
   * appears. Split across two screens, the second one would be torn off the
   * navigator mid-flow and the password would never be set — see the note on
   * `suppressSession` in the provider.
   */
  completePasswordReset: (
    email: string,
    code: string,
    password: string,
  ) => Promise<PasswordResetResult>;
  /**
   * Confirm a sign-up with the emailed code, then spend the held join codes.
   *
   * Both halves belong here rather than on the screen: confirming signs the
   * resident in, which unmounts the (auth) group the screen lives in, so the
   * join request has to be submitted by something that outlives it.
   */
  completeSignUpVerification: (email: string, code: string) => Promise<VerifyEmailResult>;
  /** Send another sign-up code to the same address, invalidating the last. */
  resendSignUpCode: (email: string) => Promise<{ error: string | null }>;
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

/**
 * Outcome of redeeming a reset code.
 *
 * `bad_code` is its own case rather than an error string because it is the one
 * outcome that is the resident's to fix, and the screen says something
 * different for it — it keeps them on the form with the code field focused,
 * instead of showing a failure that reads as "start again".
 */
export type PasswordResetResult =
  | { status: 'ok' }
  | { status: 'bad_code' }
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
  /**
   * Account created, but email confirmation is on so there is no session yet.
   * The join codes are held in the provider; the resident finishes on the
   * verify-email screen, which spends them once a code produces a session.
   */
  | { status: 'verify_email' };

/**
 * Outcome of confirming an emailed sign-up code.
 *
 * `bad_code` is separate for the same reason it is on password reset: it is the
 * one failure the resident can fix themselves, and the screen keeps them on the
 * form for it rather than showing something that reads as "start over".
 */
export type VerifyEmailResult =
  | { status: 'ok' }
  | { status: 'bad_code' }
  | { status: 'error'; message: string };

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

  /**
   * The two join codes, held between sign-up and email verification.
   *
   * A ref, and deliberately NOT route params: these travel across a screen
   * change, and putting a house code in a URL writes it into navigation state
   * and anything that logs it. It is not a password, but it is the token that
   * lets someone ask to be let into a specific house, and it has no business
   * being in a link.
   *
   * In memory only, so it does not survive the app being killed mid-flow. That
   * is the honest trade: persisting it would mean writing house codes to disk
   * to save one screen of typing. If it is gone, the resident lands on /join
   * and enters them there, which is exactly what that screen is for.
   */
  const pendingJoin = useRef<{ estateCode: string; houseCode: string } | null>(null);

  /**
   * Holds the gate still while a password reset finishes.
   *
   * Redeeming a recovery code is a SIGN-IN: verifyOtp returns a real session
   * and supabase-js broadcasts it immediately. Without this flag that broadcast
   * lands in `setSession` between redeeming the code and setting the new
   * password, `Stack.Protected guard={!signedIn}` drops the entire (auth)
   * group, and the reset screen is unmounted with its own work still in
   * flight — so the resident is thrown into the app and their password is
   * whatever it was before.
   *
   * A ref rather than state because it must take effect synchronously, before
   * the next auth event arrives; a re-render would be a frame too late. The
   * provider applies the final session itself once the password is actually
   * changed, so the gate moves exactly once, at the right moment.
   */
  const suppressSession = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (suppressSession.current) return;
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
      // `estates` is NAMED via its constraint. Left to inference it broke
      // outright the day a second foreign key appeared between memberships and
      // estates: PostgREST cannot choose between two relationships and answers
      // 300 PGRST201, so this lookup failed for every resident at once and the
      // app sat on a blank screen. supabase/tests/embeds.sql guards the class.
      .select(
        'id, estate_id, role, estates!memberships_estate_id_fkey(name), houses(house_number, house_code)',
      )
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
    // session. signUp returns one only when the project auto-confirms; with
    // email confirmation ON there is nobody to make the request AS yet.
    //
    // BOTH BRANCHES ARE LIVE, and the app must keep working either way. Whether
    // a session comes back is a DASHBOARD setting (`mailer_autoconfirm`) that
    // can be flipped without a deploy, so this cannot be written against one of
    // them. With confirmation off, sign-up completes here as it always has;
    // with it on, the resident finishes on the verify-email screen.
    //
    // The codes are stashed rather than discarded. They are the whole reason
    // this path exists: they arrived in a message from a landlord days ago, and
    // making someone find them a second time after confirming their email is
    // how a sign-up gets abandoned. completeSignUpVerification spends them the
    // moment verification produces a session.
    if (!data.session) {
      pendingJoin.current = { estateCode: input.estateCode, houseCode: input.houseCode };
      return { status: 'verify_email' };
    }

    const join = await requestHouseAccess(input.estateCode, input.houseCode);
    signUpJoin.current = join;

    // Signing up creates the account and asks to join. Access itself comes from
    // a MEMBERSHIP, which only an admin grants — so a new user lands signed in
    // with zero memberships and cannot mint anything yet. That is intended
    // (PRD §7), and it is why the gate sends them to /join next.
    return { status: 'requested', join };
  }, []);

  /**
   * Goes to our own Edge Function, NOT supabase.auth.resetPasswordForEmail.
   *
   * The built-in call mints a perfectly good token and then hands it to
   * Supabase's fallback mail service, which sends a template containing no code
   * and a link built from the project's Site URL — still `localhost:3000`, and
   * therefore dead on a phone. request-password-reset mints the same token and
   * sends it through our mail provider on the verified domain, code-first.
   */
  const requestPasswordReset = useCallback(async (email: string) => {
    try {
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/request-password-reset`,
        {
          method: 'POST',
          headers: {
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string,
            Authorization: `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email }),
        },
      );
      // A non-2xx here is a malformed address or the platform being down —
      // never "no such account", which the function answers 200 to on purpose.
      if (!res.ok) {
        return { error: 'We could not send a code just now. Please try again.' };
      }
      return { error: null };
    } catch {
      return { error: 'No connection. Try again once you are back online.' };
    }
  }, []);

  const completePasswordReset = useCallback(
    async (email: string, code: string, password: string): Promise<PasswordResetResult> => {
      // Raised BEFORE verifyOtp, because verifyOtp is what emits the session.
      suppressSession.current = true;
      try {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email,
          token: code,
          type: 'recovery',
        });

        // Wrong, expired, or already used — all indistinguishable to the
        // resident and all fixed the same way, by asking for another code.
        if (verifyError) return { status: 'bad_code' };

        const { error: updateError } = await supabase.auth.updateUser({ password });

        if (updateError) {
          // The code was spent and a session exists, but the password is still
          // the old one. Signing out is the honest end state: leaving them
          // inside the app would tell them the reset worked when the next
          // sign-in would prove otherwise.
          await supabase.auth.signOut();
          return { status: 'error', message: updateError.message };
        }

        // Only now is it safe to let the gate move. Read fresh rather than
        // reusing verifyOtp's session: updateUser reissues the tokens, and the
        // one from before the change is already stale.
        const { data } = await supabase.auth.getSession();
        suppressSession.current = false;
        setSession(data.session);
        return { status: 'ok' };
      } catch {
        return { status: 'error', message: 'No connection. Try again once you are back online.' };
      } finally {
        // Covers every path that returned without handing the session over —
        // a stuck flag here would leave the app unable to notice a sign-in for
        // the rest of the process's life.
        suppressSession.current = false;
      }
    },
    [],
  );

  /**
   * Confirm the address, then immediately spend the held join codes.
   *
   * The session is suppressed across BOTH steps for the same reason the reset
   * flow suppresses it: verifyOtp emits a session, and the gate would tear this
   * screen — and the (auth) group it sits in — off the navigator before the
   * join request had been made. Releasing it only at the end means the gate
   * moves once, to a /join that already has an answer to show.
   */
  const completeSignUpVerification = useCallback(
    async (email: string, code: string): Promise<VerifyEmailResult> => {
      suppressSession.current = true;
      try {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email,
          token: code,
          type: 'signup',
        });

        if (verifyError) return { status: 'bad_code' };

        // Now there is an identity to submit under. A failure here is NOT a
        // failed verification — the account is confirmed either way — so it
        // must not be reported as one. /join handles an absent result by
        // showing its own form.
        const codes = pendingJoin.current;
        pendingJoin.current = null;
        if (codes) {
          try {
            signUpJoin.current = await requestHouseAccess(codes.estateCode, codes.houseCode);
          } catch {
            signUpJoin.current = null;
          }
        }

        const { data } = await supabase.auth.getSession();
        suppressSession.current = false;
        setSession(data.session);
        return { status: 'ok' };
      } catch {
        return { status: 'error', message: 'No connection. Try again once you are back online.' };
      } finally {
        suppressSession.current = false;
      }
    },
    [],
  );

  const resendSignUpCode = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    // Supabase enforces its own cooldown between sends; surface that rather
    // than a generic failure, since waiting is the actual remedy.
    return { error: error?.message ?? null };
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
      requestPasswordReset,
      completePasswordReset,
      completeSignUpVerification,
      resendSignUpCode,
      takeSignUpJoinResult,
    }),
    [
      session, memberships, activeEstateId, loading, membershipsLoaded,
      refreshMemberships, signIn, signUp, signOut, deleteAccount,
      requestPasswordReset, completePasswordReset, completeSignUpVerification,
      resendSignUpCode, takeSignUpJoinResult,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
