// Onboard an estate and mint its first admin account.
//
// This is the one operation the operator dashboard cannot do from the browser.
// Creating an auth user needs the service role key, which bypasses RLS
// entirely and must never reach a client bundle — so it lives here, in Edge
// Function secrets, and the browser calls this instead.
//
// Verified against the Supabase Edge Functions docs, Aug 2026. The newer
// `npm:@supabase/server` `withSupabase` wrapper would hand back pre-built
// caller/admin clients, but its contract is thinly documented at the time of
// writing; explicit clients are the same thing with the authorization step
// visible, which is what matters most in the file that holds the service role.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

/**
 * The same 32-glyph alphabet the gate codes use: no O/0, I/1/L, so it survives
 * being read aloud down a phone line and typed by someone else.
 *
 * 256 is an exact multiple of 32, so `byte % 32` is unbiased — the modulo trap
 * that made '9' unreachable in generate_code until it was fixed.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  // Grouped, because someone is going to read this off a screen to someone else.
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'not_authenticated' }, 401);

  // The CALLER's client. Every RPC below goes through this one so the database
  // re-checks who is asking — the service role client is used only for the two
  // things that genuinely need it.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Authorization, not authentication: a valid JWT only proves they are someone.
  const { data: isOwner, error: ownerErr } = await caller.rpc('is_platform_admin');
  if (ownerErr) return json({ error: 'auth_check_failed', detail: ownerErr.message }, 401);
  if (!isOwner) return json({ error: 'not_a_platform_admin' }, 403);

  let body: {
    estate_name?: string;
    address?: string;
    contact_info?: string;
    admin_email?: string;
    admin_name?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const estateName = (body.estate_name ?? '').trim();
  const adminEmail = (body.admin_email ?? '').trim().toLowerCase();
  const adminName = (body.admin_name ?? '').trim();
  if (!estateName) return json({ error: 'estate_name_required' }, 400);
  if (!adminEmail) return json({ error: 'admin_email_required' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) return json({ error: 'admin_email_invalid' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ─── 1. the estate ────────────────────────────────────────────────────────
  // First, because it is the cheapest thing to leave behind if a later step
  // fails: an estate with no admin shows up as "Onboarding" in the dashboard,
  // which is a real state the operator can finish. An orphaned auth account is
  // not — hence the cleanup further down.
  const { data: estateId, error: estateErr } = await caller.rpc('create_estate', {
    p_name: estateName,
    p_address: body.address?.trim() || null,
    p_contact_info: body.contact_info?.trim() || null,
  });
  if (estateErr) return json({ error: 'create_estate_failed', detail: estateErr.message }, 400);

  // ─── 2. the admin's account ───────────────────────────────────────────────
  // One person can run more than one estate, so an existing address is reused
  // rather than rejected. They keep their password; only a brand-new account
  // gets a generated one to hand over.
  const { data: existing, error: findErr } = await caller.rpc('operator_find_user_by_email', {
    p_email: adminEmail,
  });
  if (findErr) return json({ error: 'lookup_failed', detail: findErr.message }, 400);

  const existingUser = Array.isArray(existing) ? existing[0] : existing;
  let userId: string | undefined = existingUser?.user_id;
  let password: string | null = null;

  if (!userId) {
    password = generatePassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      // No confirmation mail: the project is on the sandbox mailer, which does
      // not deliver to real addresses. The password is handed over in person.
      email_confirm: true,
      // No name means no name. Defaulting it to the email address would put
      // the same string in both columns of every table that shows a person.
      user_metadata: adminName ? { full_name: adminName } : {},
    });
    if (createErr) return json({ error: 'create_user_failed', detail: createErr.message }, 400);
    userId = created.user.id;
  }

  // ─── 3. the membership ────────────────────────────────────────────────────
  const { error: grantErr } = await caller.rpc('grant_membership', {
    p_estate_id: estateId,
    p_user_id: userId,
    p_role: 'admin',
  });
  if (grantErr) {
    // Only clean up an account THIS request created. Deleting a pre-existing
    // one would take an admin away from the other estates they already run.
    if (password) await admin.auth.admin.deleteUser(userId!);
    return json({ error: 'grant_membership_failed', detail: grantErr.message }, 400);
  }

  // ─── 4. force a password change ───────────────────────────────────────────
  // Only for an account created here — its password has been seen by two people
  // by the time it is first used. An existing admin's password is their own.
  if (password) {
    const { error: flagErr } = await admin
      .from('profiles')
      .update({ must_change_password: true })
      .eq('id', userId);
    // Not fatal: the estate and its admin exist and work. Failing the whole
    // request here would strand a usable estate behind a cosmetic flag.
    if (flagErr) console.error('could not set must_change_password:', flagErr.message);
  }

  const { data: estate } = await caller
    .from('estates')
    .select('id, name, join_code')
    .eq('id', estateId)
    .single();

  return json({
    estate_id: estateId,
    estate_name: estate?.name ?? estateName,
    join_code: estate?.join_code ?? null,
    admin_email: adminEmail,
    admin_user_id: userId,
    // Null when an existing account was reused — the UI must say so rather than
    // show a blank box that looks like a bug.
    password,
    reused_existing_account: password === null,
  });
});
