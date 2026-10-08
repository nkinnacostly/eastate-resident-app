import {
  OFFLINE_AUTHORISATION_TTL_SECONDS,
  POOL_STALE_THRESHOLD_SECONDS,
  SYNC_INTERVAL_SECONDS,
} from '@estate/core';
import * as Network from 'expo-network';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
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
import { AppState } from 'react-native';

import {
  bindSession,
  clearPool,
  countLivePool,
  countStranded,
  countUnsynced,
  forgetPost,
  getMeta,
  recallPost,
  rememberPost,
} from './db';
import { registerForPush, unregisterForPush } from './push';
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
  /**
   * Queued decisions belonging to a guard who is not signed in.
   *
   * They cannot be pushed without filing them under the wrong name, so they
   * wait for their own guard. Shown so that "stuck" is visible rather than
   * silent — see countStranded.
   */
  stranded: number;
  lastPullAt: string | null;
  poolAgeSeconds: number | null;
  /** Past POOL_STALE_THRESHOLD_SECONDS the keypad shows the degraded banner. */
  stale: boolean;
  /**
   * The server has not confirmed this is still their post for longer than a
   * code can live, so the phone stops verifying.
   *
   * Not the same thing as `stale`, and the difference matters at a gate. Stale
   * means "the answers may be old", and the guard works on regardless -- that
   * is the locked decision and it is right. This means "we can no longer show
   * that this person should be here", and by the time it is true every code in
   * the pool has expired anyway, so nothing admissible is being refused.
   */
  authorisationExpired: boolean;
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

function samePost(a: GuardPost | null, b: GuardPost): boolean {
  return (
    a !== null &&
    a.membership_id === b.membership_id &&
    a.estate_id === b.estate_id &&
    a.estate_name === b.estate_name
  );
}

/**
 * Take off this phone everything that only made sense for a session that is
 * over: the pool of live gate codes, and the cached post that would let a
 * restart open the keypad on them.
 *
 * Only endShift used to clear the pool, and endShift is the polite exit. A
 * refresh token revoked by an admin, or a guard removed from their post, ended
 * the session or the post without it -- and left a phone on a gate's charger
 * holding every code live at that estate, for whoever picked it up.
 *
 * The outbox is not touched. It is a ledger of decisions already made, and it
 * waits for its own guard (see unsynced in db.ts).
 *
 * Never throws: it runs from an auth listener and from sign-out, and neither
 * may be stopped by a local storage error. Whatever is missed is caught by the
 * next launch, which repeats this whenever it finds no session.
 */
async function forgetLocalShift(): Promise<void> {
  try {
    await clearPool();
    await forgetPost();
  } catch (e) {
    console.warn('[shift] could not clear this phone\'s pool', e);
  }
}

export function ShiftProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [post, setPost] = useState<GuardPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [poolCount, setPoolCount] = useState(0);
  const [queued, setQueued] = useState(0);
  const [stranded, setStranded] = useState(0);
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
    supabase.auth.getSession().then(({ data, error }) => {
      setSession(data.session);
      setLoading(false);
      // No session at launch is a session that ended while the app was not
      // looking -- a refresh token revoked between runs is discovered while
      // the client is being constructed, and its SIGNED_OUT fires before this
      // listener exists to hear it. So the launch does the listener's job.
      //
      // Except when the reason is the network. An expired access token that
      // could not be refreshed offline reads as "no session" here too, but
      // auth-js keeps it on disk and it comes back with the signal. Wiping the
      // pool for that would punish an outage.
      if (!data.session && !isAuthRetryableFetchError(error)) void forgetLocalShift();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // However the session ended -- endShift, a revoked refresh token, a
      // sign-out from anywhere -- the codes go with it. Not keyed on `!next`:
      // the very first render has no session either, and wiping on that would
      // empty the pool on every launch, offline included.
      if (event === 'SIGNED_OUT') void forgetLocalShift();
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Bumped to ask the server about the post again without a new session. See
  // `sync`: a post restored from the cache keeps asking until it is answered.
  const [recheck, setRecheck] = useState(0);
  // True while the post on screen is the cached one rather than the server's.
  const postFromCache = useRef(false);

  // Resolved per session, never from a JWT claim — a guard removed from a post
  // mid-shift must lose access at the next resolve, not at the next refresh.
  useEffect(() => {
    if (!session) {
      postFromCache.current = false;
      setPost(null);
      return;
    }
    let cancelled = false;
    const userId = session.user.id;
    void (async () => {
      const cached = await recallPost(userId);
      if (cancelled) return;

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
        // Constraint named deliberately -- see the note in the resident app's
        // auth.tsx. An inferred embed here broke every guard's shift start the
        // day a second memberships<->estates foreign key was added.
        .select('id, estate_id, created_at, estates!memberships_estate_id_fkey(name)')
        .eq('user_id', session.user.id)
        .eq('role', 'guard')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        // postgrest retries a failed GET three times, 1s + 2s + 4s, before it
        // gives up. With nothing cached that wait is worth it. With a cached
        // post it is seven seconds of the sign-in screen at a gate that has
        // no signal, for an answer that was never coming.
        .retry(!cached);

      if (cancelled) return;

      // ── Could not ask ─────────────────────────────────────────────────────
      //
      // An error is not an answer. Offline, a dead uplink, a captive portal,
      // a 5xx -- none of them says this person stopped being a guard, and
      // treating them as if they did is what locked every guard out of
      // offline verification on any restart during an outage: no post, so
      // the keypad was replaced by sign-in, and sign-in needs the network.
      //
      // So the last post the server confirmed for THIS user stands in. It
      // grants nothing the server did not already grant, and it is not open-
      // ended: verifyOffline still locks once the last successful pull is
      // older than a code can live (OFFLINE_AUTHORISATION_TTL_SECONDS).
      //
      // Any error, not only a network one, and that is safe for a specific
      // reason: removal never arrives as an error. A deactivated membership
      // is a row RLS still returns with is_active false, so the filtered
      // query answers SUCCESSFULLY with nothing -- the branch below.
      if (error) {
        console.warn('[shift] could not resolve the post', error.message);
        if (!cached) {
          postFromCache.current = false;
          setPost(null);
          return;
        }
        await bindSession(cached.estate_id, cached.membership_id);
        if (cancelled) return;
        const restored: GuardPost = {
          membership_id: cached.membership_id,
          estate_id: cached.estate_id,
          estate_name: cached.estate_name,
        };
        postFromCache.current = true;
        setPost((prev) => (samePost(prev, restored) ? prev : restored));
        return;
      }

      // ── Answered: no post ─────────────────────────────────────────────────
      //
      // The server says this person is not an active guard anywhere. That is
      // authoritative, so there is no falling back -- and the phone must stop
      // holding the gate's codes for them, since nothing else would ever
      // clear them while the session lives on.
      if (!data?.length) {
        postFromCache.current = false;
        setPost(null);
        await forgetLocalShift();
        // Still signed in, so this can still be done as them.
        void unregisterForPush();
        return;
      }

      const m = data[0];
      // Before anything may READ the pool. A cache filled at another estate is
      // not ours to verify against, and sign-out is not a reliable place to
      // have dropped it — see bindSession. This also records WHO is on shift,
      // which every queued decision is stamped with.
      await bindSession(m.estate_id, m.id);
      if (cancelled) return;
      const resolved: GuardPost = {
        membership_id: m.id,
        estate_id: m.estate_id,
        estate_name: (m.estates as { name: string } | null)?.name ?? 'Unknown estate',
      };
      await rememberPost({ user_id: userId, ...resolved });
      if (cancelled) return;
      postFromCache.current = false;
      // Same object when nothing changed, so a cached post being confirmed
      // does not re-run everything keyed on `post` -- the first sync,
      // start_shift, push registration -- a second time.
      setPost((prev) => (samePost(prev, resolved) ? prev : resolved));
    })();
    return () => {
      cancelled = true;
    };
  }, [session, recheck]);

  const membershipId = post?.membership_id ?? null;

  const refresh = useCallback(async () => {
    setPoolCount(await countLivePool());
    setQueued(await countUnsynced(membershipId));
    setStranded(await countStranded(membershipId));
    setLastPullAt(await getMeta('last_pull_at'));
  }, [membershipId]);

  const sync = useCallback(async () => {
    if (!post) return;
    setSyncing(true);
    try {
      await syncNow(post.estate_id, post.membership_id);
    } catch {
      // Deliberately swallowed. A failed sync is the NORMAL state at a gate with
      // no signal; the banner already tells the guard the pool is stale. Throwing
      // here would surface an error dialog every 45 seconds during an outage.
    } finally {
      setSyncing(false);
      await refresh();
      // A post restored from the cache is provisional: it is what the server
      // said last time, not what it says now. Riding the sync loop means it
      // is re-asked on every tick, on wake and on reconnect -- each a moment
      // the answer might finally arrive -- and stops the moment it does,
      // including when the answer is that this guard has been removed.
      if (postFromCache.current) setRecheck((n) => n + 1);
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
        await syncNow(post.estate_id, post.membership_id);
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
    // While there is still a session to do it as -- the delete is checked
    // against auth.uid(). Bounded and never throws; see unregisterForPush.
    await unregisterForPush();
    await forgetLocalShift(); // cache, not ledger
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
      stranded,
      lastPullAt,
      poolAgeSeconds,
      stale: poolAgeSeconds !== null && poolAgeSeconds > POOL_STALE_THRESHOLD_SECONDS,
      authorisationExpired:
        poolAgeSeconds !== null && poolAgeSeconds > OFFLINE_AUTHORISATION_TTL_SECONDS,
      syncing,
      mustChangePassword,
      refresh,
      sync,
      signIn,
      setPassword,
      endShift,
    }),
    [
      session, post, loading, online, poolCount, queued, stranded, lastPullAt,
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
