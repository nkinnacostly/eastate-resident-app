import { POOL_STALE_THRESHOLD_SECONDS, SYNC_INTERVAL_SECONDS } from '@estate/core';
import * as Network from 'expo-network';
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
import { AppState } from 'react-native';

import { clearPool, countLivePool, countUnsynced, getMeta } from './db';
import { registerForPush } from './push';
import { supabase } from './supabase';
import { syncNow } from './sync';

export interface GuardPost {
  membership_id: string;
  estate_id: string;
  estate_name: string;
}

interface ShiftState {
  session: Session | null;
  post: GuardPost | null;
  loading: boolean;
  /** Device has a usable connection. Not the same as "the server answered". */
  online: boolean;
  poolCount: number;
  queued: number;
  lastPullAt: string | null;
  poolAgeSeconds: number | null;
  /** Past POOL_STALE_THRESHOLD_SECONDS the keypad shows the degraded banner. */
  stale: boolean;
  syncing: boolean;
  /**
   * This account still carries the password an admin generated and read out.
   * Null while unknown — distinct from false, because routing on "not yet
   * loaded" would flash the keypad at a guard who is about to be sent to the
   * set-password screen.
   */
  mustChangePassword: boolean | null;
  refresh: () => Promise<void>;
  sync: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  setPassword: (next: string) => Promise<{ error: string | null }>;
  endShift: () => Promise<void>;
}

const Ctx = createContext<ShiftState | null>(null);

export function ShiftProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [post, setPost] = useState<GuardPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [poolCount, setPoolCount] = useState(0);
  const [queued, setQueued] = useState(0);
  const [lastPullAt, setLastPullAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // expo-network's hook: { isConnected, isInternetReachable, type } — verified
  // against the SDK 54 docs. isInternetReachable is the honest one; isConnected
  // is true on a wifi network that has no route out, which is exactly the
  // gate-with-a-dead-uplink case.
  const net = Network.useNetworkState();
  const online = (net.isInternetReachable ?? net.isConnected ?? false) === true;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Resolved per session, never from a JWT claim — a guard removed from a post
  // mid-shift must lose access at the next resolve, not at the next refresh.
  useEffect(() => {
    if (!session) {
      setPost(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      // user_id is filtered HERE rather than left to RLS. The policy is
      // "read own OR as estate admin OR platform admin", so for anyone
      // holding an admin membership this query would also return every OTHER
      // guard's row at that estate — and `limit(1)` with no order would pick
      // one at random. The app would then sign in against an estate this
      // person is not a guard at, and every verification would come back
      // not_a_guard_at_this_estate with nothing on screen to explain it.
      //
      // The ordering matters for the ordinary case too: a guard who works two
      // estates got a different post on each launch.
      const { data, error } = await supabase
        .from('memberships')
        .select('id, estate_id, created_at, estates(name)')
        .eq('user_id', session.user.id)
        .eq('role', 'guard')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1);

      if (cancelled) return;
      if (error || !data?.length) {
        setPost(null);
        return;
      }
      const m = data[0];
      setPost({
        membership_id: m.id,
        estate_id: m.estate_id,
        estate_name: (m.estates as { name: string } | null)?.name ?? 'Unknown estate',
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const refresh = useCallback(async () => {
    setPoolCount(await countLivePool());
    setQueued(await countUnsynced());
    setLastPullAt(await getMeta('last_pull_at'));
  }, []);

  const sync = useCallback(async () => {
    if (!post) return;
    setSyncing(true);
    try {
      await syncNow(post.estate_id);
    } catch {
      // Deliberately swallowed. A failed sync is the NORMAL state at a gate with
      // no signal; the banner already tells the guard the pool is stale. Throwing
      // here would surface an error dialog every 45 seconds during an outage.
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [post, refresh]);

  // First sync as soon as a post resolves — "signing in downloads live codes".
  useEffect(() => {
    if (post) void sync();
  }, [post, sync]);

  // Periodic sync while the app is in the foreground. Stopping in background is
  // deliberate: a phone in a pocket burning battery to poll helps nobody, and
  // the guard syncs on wake anyway.
  useEffect(() => {
    if (!post) return;
    const tick = setInterval(() => {
      if (AppState.currentState === 'active') void sync();
    }, SYNC_INTERVAL_SECONDS * 1000);
    const wake = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sync();
    });
    return () => {
      clearInterval(tick);
      wake.remove();
    };
  }, [post, sync]);

  // Reconnect is the moment the queue can drain — don't wait for the next tick.
  useEffect(() => {
    if (online && post) void sync();
  }, [online, post, sync]);

  // Drives the freshness readout without re-rendering on every state change.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const poolAgeSeconds = useMemo(() => {
    if (!lastPullAt) return null;
    const ms = now - new Date(lastPullAt).getTime();
    return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null;
  }, [lastPullAt, now]);

  /**
   * Is this account still on its handover password?
   *
   * onboard-guard sets profiles.must_change_password when an ADMIN generates
   * the account, because by the time that password is first used it has been
   * read off a screen and spoken aloud at a gate. The flag was already being
   * written and nothing in this app ever read it, so it changed nothing for
   * the people it was written about.
   *
   * Resolved from the session rather than the post: a guard with no post yet
   * still has an account whose password two people know.
   *
   * A failed read resolves to false rather than staying null. Null holds the
   * app on a spinner, and the failure mode of guessing wrong here is a guard
   * who is not asked to change a password — which is where we already were.
   * Holding the gate shut over it would be worse.
   */
  useEffect(() => {
    if (!session) {
      setMustChangePassword(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('must_change_password')
        .eq('id', session.user.id)
        .single();
      if (cancelled) return;
      if (error) {
        console.warn('[shift] could not read must_change_password', error.message);
        setMustChangePassword(false);
        return;
      }
      setMustChangePassword(Boolean(data?.must_change_password));
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  /**
   * Set a new password, then drop the flag.
   *
   * Order matters and the flag is cleared through an RPC rather than an UPDATE:
   * column-level grants (20260815180000) mean a client cannot write
   * must_change_password directly, so the only way to clear it is
   * clear_must_change_password(), which exists precisely so it cannot be
   * cleared WITHOUT changing the password.
   */
  const setPassword = useCallback(async (next: string) => {
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) return { error: error.message };
    const { error: clearErr } = await supabase.rpc('clear_must_change_password');
    if (clearErr) return { error: clearErr.message };
    setMustChangePassword(false);
    return { error: null };
  }, []);

  /**
   * Open the shift once we know which gate this is.
   *
   * This is what tells every resident on the estate that someone is on duty —
   * `start_shift` queues that notification, ONCE. Calling it again returns
   * `already_on_shift` and queues nothing, which is why it is safe to run on
   * every launch and resume rather than only on a fresh sign-in.
   *
   * Not awaited by anything and never surfaced: a guard whose shift row failed
   * to open must still be able to verify codes. The gate is the job; the
   * bookkeeping is not allowed to block it.
   */
  useEffect(() => {
    if (!post) return;
    void supabase
      .rpc('start_shift', { p_estate_id: post.estate_id })
      .then(({ data, error }) => {
        if (error) console.warn('[shift] start_shift failed', error.message);
        else console.log('[shift] start_shift ->', data?.[0]?.result);
      });
  }, [post]);

  /**
   * Register this device to receive `forced_pull` wake-ups.
   *
   * Keyed on the post rather than the session because the token is stored
   * against a MEMBERSHIP, so there is nothing to register until we know which
   * estate this guard is on. Re-running on every post change is harmless —
   * `register_push_token` upserts on (membership, token).
   *
   * Deliberately not awaited and never surfaced. A guard who declined
   * notifications still verifies codes normally; they just fall back to the
   * periodic pull for pool freshness instead of being woken early.
   */
  useEffect(() => {
    if (!post) return;
    void registerForPush(post.estate_id);
  }, [post]);

  const endShift = useCallback(async () => {
    // Push whatever is queued BEFORE dropping the session — otherwise the
    // outbox survives on disk but nobody is authenticated to replay it.
    if (post) {
      try {
        await syncNow(post.estate_id);
      } catch {
        // Still sign out. The outbox persists and replays on the next shift.
      }
      try {
        // Close the shift while still authenticated. Deliberately sends no
        // notification — residents are told when the gate is manned, not when
        // it is left, which is both alarming and an invitation.
        await supabase.rpc('end_shift', { p_estate_id: post.estate_id });
      } catch {
        // A shift left open is tidied by the next guard's handover.
      }
    }
    await clearPool(); // cache, not ledger
    await supabase.auth.signOut();
  }, [post]);

  const value = useMemo<ShiftState>(
    () => ({
      session,
      post,
      loading,
      online,
      poolCount,
      queued,
      lastPullAt,
      poolAgeSeconds,
      stale: poolAgeSeconds !== null && poolAgeSeconds > POOL_STALE_THRESHOLD_SECONDS,
      syncing,
      mustChangePassword,
      refresh,
      sync,
      signIn,
      setPassword,
      endShift,
    }),
    [
      session, post, loading, online, poolCount, queued, lastPullAt,
      poolAgeSeconds, syncing, mustChangePassword, refresh, sync, signIn,
      setPassword, endShift,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShift(): ShiftState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useShift must be used inside <ShiftProvider>');
  return ctx;
}
