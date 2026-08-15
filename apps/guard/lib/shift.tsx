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
  refresh: () => Promise<void>;
  sync: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
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
      const { data, error } = await supabase
        .from('memberships')
        .select('id, estate_id, estates(name)')
        .eq('role', 'guard')
        .eq('is_active', true)
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

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const endShift = useCallback(async () => {
    // Push whatever is queued BEFORE dropping the session — otherwise the
    // outbox survives on disk but nobody is authenticated to replay it.
    if (post) {
      try {
        await syncNow(post.estate_id);
      } catch {
        // Still sign out. The outbox persists and replays on the next shift.
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
      refresh,
      sync,
      signIn,
      endShift,
    }),
    [
      session, post, loading, online, poolCount, queued, lastPullAt,
      poolAgeSeconds, syncing, refresh, sync, signIn, endShift,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShift(): ShiftState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useShift must be used inside <ShiftProvider>');
  return ctx;
}
