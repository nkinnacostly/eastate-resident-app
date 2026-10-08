// Register a guard at an estate, on behalf of that estate's admin.
//
// The sibling of onboard-estate, one rung down the ladder: that one is called
// by the platform owner and mints an estate plus its first admin; this one is
// called by an estate admin and mints a guard at an estate that already exists.
// Same reason for living in an Edge Function — creating an auth user needs the
// service role key, which bypasses RLS entirely and must never reach a browser
// bundle.
//
// Guards do not sign up. A guard is hired by an estate and put on the gate by
// its administrator, which is why there is no self-service path anywhere and
// why this endpoint exists at all.
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
 * being read aloud and typed by someone else. That matters more here than
 * anywhere: this password is usually handed to a guard in person, at a gate,
 * off a phone screen.
 *
 * 256 is an exact multiple of 32, so `byte % 32` is unbiased — the modulo trap
 * that made '9' unreachable in generate_code until it was fixed.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'not_authenticated' }, 401);

  // The CALLER's client. The authorization check below goes through this one so
  // the database re-derives who is asking from their JWT; the service role
  // client is used only for the things that genuinely need it.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { estate_id?: string; email?: string; full_name?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const estateId = (body.estate_id ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const fullName = (body.full_name ?? '').trim();
  const phone = (body.phone ?? '').trim();

  if (!estateId) return json({ error: 'estate_id_required' }, 400);
  if (!email) return json({ error: 'email_required' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'email_invalid' }, 400);

  // ─── authorization ────────────────────────────────────────────────────────
  //
  // BEFORE anything is created. grant_membership would refuse a non-admin on
  // its own, but it runs at step 3 — by then this function would already have
  // created an auth account, and a failed grant would leave that account
  // orphaned. Worse, anyone with a valid JWT could mint accounts at will by
  // pointing this at an estate they have nothing to do with. The estate id is
  // supplied by the client, so it is checked, never trusted.
  const { data: isAdmin, error: adminErr } = await caller.rpc('has_membership', {
    p_estate_id: estateId,
    p_role: 'admin',
  });
  if (adminErr) return json({ error: 'auth_check_failed', detail: adminErr.message }, 401);
  if (!isAdmin) return json({ error: 'not_an_admin_at_this_estate' }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ─── 1. the guard's account ───────────────────────────────────────────────
  //
  // Reuse before create. A guard may already have an account: they work a
  // second estate, or they live at this one and already hold a resident
  // membership. Creating a second auth user for the same human would split
  // their identity in two and break the one-human-one-users-row rule.
  //
  // The lookup runs on the SERVICE ROLE client deliberately — the underlying
  // function is granted to service_role only, so an estate admin cannot use it
  // to probe whether arbitrary addresses have accounts. See the migration.
  const { data: existing, error: findErr } = await admin.rpc('service_find_user_by_email', {
    p_email: email,
  });
  if (findErr) return json({ error: 'lookup_failed', detail: findErr.message }, 400);

  const existingUser = Array.isArray(existing) ? existing[0] : existing;
  let userId: string | undefined = existingUser?.user_id;
  let password: string | null = null;

  if (!userId) {
    password = generatePassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      // No confirmation mail: the guard is standing in front of the admin, and
      // the account has to work on the gate phone now, not after they find an
      // inbox. The set-password link further down is the unhurried path.
      email_confirm: true,
      // No name means no name. Defaulting it to the email address would put the
      // same string in both columns of every table that shows a person — and
      // this name is what residents see as "on duty".
      user_metadata: fullName ? { full_name: fullName } : {},
      // email_confirm above says "this address is verified", but nobody has
      // proved it: an estate admin typed it and holds the password. Landlord
      // access is keyed on a confirmed address, so without this flag any
      // estate admin could create an account on a landlord's email and read
      // that landlord's houses at every OTHER estate. current_verified_email()
      // refuses a flagged account until its owner signs in through an emailed
      // code. app_metadata, because the user cannot write it.
      app_metadata: { email_unproven: true },
    });
    if (createErr) return json({ error: 'create_user_failed', detail: createErr.message }, 400);
    userId = created.user.id;
  }

  // ─── 2. the membership ────────────────────────────────────────────────────
  //
  // Through the CALLER's client, so grant_membership re-checks for itself that
  // this person administers this estate. The check above is what stops an
  // orphaned account being created; this is what actually enforces the rule.
  const { error: grantErr } = await caller.rpc('grant_membership', {
    p_estate_id: estateId,
    p_user_id: userId,
    p_role: 'guard',
  });
  if (grantErr) {
    // Only clean up an account THIS request created. Deleting a pre-existing
    // one would take a person away from the other estates they already work,
    // or delete their resident account at this one.
    if (password) await admin.auth.admin.deleteUser(userId!);
    return json({ error: 'grant_membership_failed', detail: grantErr.message }, 400);
  }

  // ─── 3. the profile ───────────────────────────────────────────────────────
  //
  // A phone number is worth having on a guard: it is how an admin reaches the
  // gate when something is wrong. Only filled in on an account THIS request
  // created. An existing account belongs to someone who may live or work at
  // other estates: patching it would let any estate admin rename any user on
  // the platform — and this name is what residents elsewhere see as "on duty".
  if (password && (fullName || phone)) {
    const patch: Record<string, string> = {};
    if (fullName) patch.full_name = fullName;
    if (phone) patch.phone = phone;
    const { error: profileErr } = await admin.from('profiles').update(patch).eq('id', userId);
    // Not fatal. The guard can sign in and hold a shift; a missing phone number
    // is a gap in a contact list, not a broken account.
    if (profileErr) console.error('could not update guard profile:', profileErr.message);
  }

  // ─── 4. force a password change ───────────────────────────────────────────
  //
  // Only for an account created here — by the time it is first used its
  // password has been seen by two people.
  //
  // KNOWN GAP, recorded rather than papered over: this flag is currently read
  // only by the WEB dashboard (apps/web/src/lib/auth.tsx). The guard app does
  // not check it, and guards sign in there, so today this changes nothing for
  // them in practice. It is still set, because it is the true statement about
  // the account and because the guard app honouring it is a change to the guard
  // app, not to this function. Until then the emailed set-password link below
  // is the real remedy.
  if (password) {
    const { error: flagErr } = await admin
      .from('profiles')
      .update({ must_change_password: true })
      .eq('id', userId);
    if (flagErr) console.error('could not set must_change_password:', flagErr.message);
  }

  const { data: estate } = await caller
    .from('estates')
    .select('id, name')
    .eq('id', estateId)
    .single();

  // ─── 5. tell the guard, by email ──────────────────────────────────────────
  //
  // Deliberately does NOT contain the password, for the same reason as
  // onboard-estate: mail sits in inboxes for years, is forwarded, and is read
  // on shared screens. The guard gets a one-time link and picks their own.
  //
  // The generated password is still returned to the admin, because the
  // realistic handover is a person at a gate who may not have an inbox on
  // their phone at all.
  let setPasswordUrl: string | null = null;
  if (password) {
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });
    if (linkErr) console.error('could not generate set-password link:', linkErr.message);
    else setPasswordUrl = link?.properties?.action_link ?? null;
  }

  // Enqueued, not sent inline: the send belongs on the same cron-driven path as
  // every other email, and a mail-provider hiccup must not fail an onboarding that has
  // already created a user and a membership.
  const { error: mailErr } = await admin.rpc('enqueue_email', {
    p_kind: 'guard_welcome',
    p_payload: {
      to: email,
      guard_user_id: userId,
      estate_id: estateId,
      guard_name: fullName || null,
      estate_name: estate?.name ?? null,
      set_password_url: setPasswordUrl,
    },
  });
  if (mailErr) console.error('could not enqueue guard welcome email:', mailErr.message);

  return json({
    estate_id: estateId,
    guard_user_id: userId,
    email,
    // Only what the caller typed. Echoing an existing account's name back would
    // tell any estate admin who owns any email address on the platform.
    full_name: fullName || null,
    // Null when an existing account was reused — the UI must say so rather than
    // show a blank box that looks like a bug.
    password,
    reused_existing_account: password === null,
    welcome_email_queued: !mailErr,
  });
});
