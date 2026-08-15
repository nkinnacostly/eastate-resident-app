import type { RejectReason } from '@estate/core';
import * as Crypto from 'expo-crypto';

import {
  burnLocally,
  enqueue,
  findInPool,
  findInPoolIgnoringExpiry,
  getMeta,
  type PoolCode,
} from './db';
import { supabase } from './supabase';

export type Verdict =
  | {
      decision: 'admit';
      code: string;
      checkedWith: 'server' | 'device';
      /** Only the server knows who issued it; offline this stays null. */
      host: { name: string; unit: string | null } | null;
      issuedAt: string | null;
      clientEventId: string;
    }
  | {
      decision: 'refuse';
      code: string;
      checkedWith: 'server' | 'device';
      reason: RejectReason;
      detail: string | null;
      clientEventId: string;
    }
  | {
      decision: 'flagged';
      code: string;
      checkedWith: 'device';
      clientEventId: string;
    };

/** Human sentence for each machine reason, so the guard can say it out loud. */
export const REJECT_COPY: Record<RejectReason, string> = {
  unknown_code: 'No such code',
  expired: 'Expired',
  already_used: 'Already used',
  revoked: 'Cancelled by the estate',
};

async function poolAgeSeconds(): Promise<number | null> {
  const last = await getMeta('last_pull_at');
  if (!last) return null;
  const ms = Date.now() - new Date(last).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null;
}

/**
 * Verify against the server. The burn is atomic inside verify_access_code —
 * this function never decides anything itself, it only reports.
 */
export async function verifyOnline(estateId: string, code: string): Promise<Verdict> {
  // Generated HERE, before the call, so a retry after a lost response carries
  // the SAME id and the server dedupes it rather than burning a second code.
  const clientEventId = Crypto.randomUUID();

  const { data, error } = await supabase.rpc('verify_access_code', {
    p_estate_id: estateId,
    p_code: code,
    p_client_event_id: clientEventId,
  });
  if (error) throw new Error(error.message);

  // host_name / host_unit are populated by the server ONLY on an admitted
  // verdict — on any refusal they come back null, so a guard cannot use the
  // keypad to enumerate who owns which code.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('verify_access_code returned no row');

  // Mirror the decision into the local ledger, marked ALREADY SYNCED.
  //
  // Without this an online check leaves no trace on the phone: the shift log
  // reads the outbox, so a guard who worked a whole shift with signal saw
  // "0 checks on this phone". synced=1 keeps it out of the replay queue — the
  // server committed it, so it is a log entry, not a debt.
  await enqueue(
    {
      client_event_id: clientEventId,
      code,
      code_id: row.code_id ?? null,
      outcome: row.outcome === 'admitted' ? 'admitted' : 'rejected',
      reject_reason: row.reject_reason ?? null,
      // The server's own timestamp, which beats the device clock when we have it.
      verified_at: row.verified_at ?? new Date().toISOString(),
      pool_age_seconds: null, // irrelevant: this verdict did not come from the pool
    },
    1,
  );

  if (row.outcome === 'admitted') {
    return {
      decision: 'admit',
      code,
      checkedWith: 'server',
      host: row.host_name ? { name: row.host_name, unit: row.host_unit ?? null } : null,
      issuedAt: row.verified_at ?? null,
      clientEventId,
    };
  }

  return {
    decision: 'refuse',
    code,
    checkedWith: 'server',
    reason: (row.reject_reason ?? 'unknown_code') as RejectReason,
    // `collision` means another event already burned this code — worth saying
    // out loud, because it is the "someone already came through" case.
    detail: row.collision ? 'Another gate already burned this code.' : null,
    clientEventId,
  };
}

/**
 * Verify against the pool on this phone.
 *
 * Three rules that are easy to get wrong, all of them deliberate:
 *
 * 1. A STALE POOL STILL ADMITS. Refusing to verify on old data turns a network
 *    outage into a gate outage. Staleness is surfaced in the banner and stamped
 *    on the event as pool_age_seconds; it is never a reason to refuse (§5.4).
 * 2. Expiry is computed locally, because offline there is nobody to ask — and a
 *    code past expires_at is expired no matter what the row says (§2.4).
 * 3. The local burn is provisional. It stops THIS phone re-admitting the code
 *    during the outage. The real burn happens when the outbox replays.
 */
export async function verifyOffline(code: string): Promise<Verdict> {
  const clientEventId = Crypto.randomUUID();
  const age = await poolAgeSeconds();
  const now = new Date().toISOString();

  const hit: PoolCode | null = await findInPool(code);

  if (hit) {
    await burnLocally(hit.id);
    await enqueue({
      client_event_id: clientEventId,
      code,
      code_id: hit.id,
      outcome: 'admitted',
      reject_reason: null,
      verified_at: now,
      pool_age_seconds: age,
    });
    return { decision: 'admit', code, checkedWith: 'device', host: null, issuedAt: null, clientEventId };
  }

  // Distinguish "expired" from "never heard of it" — the guard has to tell the
  // visitor something true, and those are different conversations.
  const stale = await findInPoolIgnoringExpiry(code);
  const reason: RejectReason = stale ? 'expired' : 'unknown_code';

  // Rejections are logged too. A gate attempt that failed is exactly what an
  // admin needs to see later (PRD: every attempt is recorded).
  await enqueue({
    client_event_id: clientEventId,
    code,
    code_id: stale?.id ?? null,
    outcome: 'rejected',
    reject_reason: reason,
    verified_at: now,
    pool_age_seconds: age,
  });

  return { decision: 'refuse', code, checkedWith: 'device', reason, detail: null, clientEventId };
}

/**
 * The admit-and-flag fallback.
 *
 * The guard overrides a refusal — a resident vouched at the window, or the pool
 * is simply missing a code minted during the outage. It is recorded with the
 * guard's name and replayed for an admin to reconcile. Never silent.
 */
export async function admitAndFlag(code: string): Promise<Verdict> {
  const clientEventId = Crypto.randomUUID();
  await enqueue({
    client_event_id: clientEventId,
    code,
    code_id: null,
    outcome: 'flagged',
    reject_reason: null,
    verified_at: new Date().toISOString(),
    pool_age_seconds: await poolAgeSeconds(),
  });
  return { decision: 'flagged', code, checkedWith: 'device', clientEventId };
}
