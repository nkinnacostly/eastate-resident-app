// Self-service account deletion.
//
// Two halves, because they need different authority:
//
//   1. public.delete_my_account() runs as the CALLER. It derives identity from
//      auth.uid(), so there is no user id on the wire that a client could forge,
//      and it refuses the cases that would strand an estate.
//   2. auth.admin.deleteUser() needs the service role, which bypasses RLS
//      entirely and therefore never leaves this function.
//
// Order matters. The profile scrub runs first; only if it reports 'deleted' is
// the auth user removed. Doing it the other way round would leave orphaned
// memberships behind an account nobody can sign into — invisible, and
// unreachable by the person who asked to be forgotten.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'missing_token' }, 401);

  // Acts as the caller: every RLS policy and auth.uid() applies as normal.
  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'invalid_token' }, 401);
  const userId = userData.user.id;

  const { data, error } = await caller.rpc('delete_my_account');
  if (error) return json({ error: 'scrub_failed', detail: error.message }, 400);

  // returns table(...) always arrives as an array.
  const row = Array.isArray(data) ? data[0] : data;
  const status = row?.status as string | undefined;

  if (status === 'last_admin') {
    return json(
      {
        error: 'last_admin',
        detail: row?.detail,
        message:
          `You are the only administrator of ${row?.detail}. Make someone else ` +
          `an administrator there first, then delete your account.`,
      },
      409,
    );
  }
  if (status === 'has_verified_entries') {
    return json(
      {
        error: 'has_verified_entries',
        message:
          'This account has verified visitors at a gate. Those entries are part ' +
          'of the estate security record, so the estate administrator has to ' +
          'close this account.',
      },
      409,
    );
  }
  if (status !== 'deleted') {
    return json({ error: status ?? 'unknown_status' }, 400);
  }

  // Only now, and only with the key that never reaches a client.
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    // The personal data is already gone; the shell account is not. Say so
    // rather than reporting a clean success.
    return json(
      {
        error: 'auth_delete_failed',
        detail: delErr.message,
        message:
          'Your personal details were removed but the sign-in record could not ' +
          'be deleted. Contact support so it can be finished.',
      },
      500,
    );
  }

  return json({ ok: true, deleted: true });
});
