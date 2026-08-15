import type { SyncPullResult } from '@estate/core';

import { applyPull, getMeta, markSynced, setMeta, unsynced } from './db';
import { supabase } from './supabase';

/**
 * Pull one page of pool changes.
 *
 * The cursor is SERVER-owned (`sync_seq`), never a timestamp — device clocks
 * drift, and a phone set to the wrong year would either skip rows forever or
 * re-pull the whole table on every tick (§10).
 *
 * sync_pull returns at most 500 rows per call, so a device that has been off
 * for a long time needs several passes; `drained` tells the caller whether to
 * keep going.
 */
export async function pullOnce(estateId: string): Promise<{ drained: boolean; applied: number }> {
  const cursor = Number(await getMeta('cursor') ?? 0);

  const { data, error } = await supabase.rpc('sync_pull', {
    p_estate_id: estateId,
    p_cursor: cursor,
  });
  if (error) throw new Error(error.message);

  const page = data as unknown as SyncPullResult;
  const applied = page.upserts.length + page.tombstones.length;

  await applyPull(page.upserts, page.tombstones, page.cursor);
  await setMeta('last_pull_at', new Date().toISOString());

  // Cursor unchanged means the server had nothing past it — we are current.
  return { drained: page.cursor === cursor || applied === 0, applied };
}

export async function pull(estateId: string, maxPages = 10): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxPages; i++) {
    const { drained, applied } = await pullOnce(estateId);
    total += applied;
    if (drained) break;
  }
  return total;
}

/**
 * Replay queued verifications.
 *
 * Only rows the server ACKNOWLEDGED are marked synced. Marking the whole batch
 * on a 200 would drop any event the server chose not to return, and an event
 * dropped here is an audit record that no longer exists anywhere.
 */
export async function push(estateId: string): Promise<{ pushed: number; collisions: number }> {
  const queue = await unsynced();
  if (queue.length === 0) return { pushed: 0, collisions: 0 };

  const { data, error } = await supabase.rpc('ingest_verification_events', {
    p_estate_id: estateId,
    p_events: queue.map((e) => ({
      client_event_id: e.client_event_id,
      code_id: e.code_id,
      code: e.code,
      verified_at: e.verified_at,
      pool_age_seconds: e.pool_age_seconds,
    })),
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { client_event_id: string; collision: boolean }[];
  await markSynced(rows.map((r) => r.client_event_id));

  return {
    pushed: rows.length,
    // Surfaced to the admin, never silently dropped (§5.3).
    collisions: rows.filter((r) => r.collision).length,
  };
}

/**
 * One full cycle. Push BEFORE pull, deliberately: a queued burn should reach
 * the server before we ask for a pool that would otherwise still contain the
 * code we just burned and hand it back as live.
 */
export async function syncNow(estateId: string): Promise<{
  pushed: number;
  collisions: number;
  applied: number;
}> {
  const { pushed, collisions } = await push(estateId);
  const applied = await pull(estateId);
  return { pushed, collisions, applied };
}
