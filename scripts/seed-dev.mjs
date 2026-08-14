#!/usr/bin/env node
/**
 * Seeds a demo estate with one resident, one guard, and one admin so the apps
 * have something to sign in as.
 *
 * Uses the service role key, which BYPASSES RLS — that is why this lives in a
 * root-only script and reads from the root .env.local, never from an app
 * directory. Never import anything from here into client code.
 *
 *     node scripts/seed-dev.mjs          # create
 *     node scripts/seed-dev.mjs --reset  # delete first, then create
 *
 * Users are created through the Auth Admin API rather than SQL. Inserting into
 * auth.users directly couples you to GoTrue's internal schema and produces rows
 * that fail sign-in with an unhelpful "Database error querying schema" — this
 * project already learned that the hard way.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    die('Could not read .env.local at the repo root.');
  }
  return out;
}

const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SVC) {
  die('Need EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the root .env.local');
}

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/** Retries transient TLS/network faults, which this host has been prone to. */
async function api(path, { method = 'POST', body, headers = {} } = {}, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(URL_ + path, {
        method,
        headers: {
          apikey: SVC,
          Authorization: `Bearer ${SVC}`,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: res.status, body: json };
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  die(`Network failed after ${tries} attempts: ${last?.message ?? last}`);
}

const ESTATE_ID = 'dddd0000-0000-4000-8000-000000000001';
const ESTATE_NAME = 'Demo Estate';
const PASSWORD = 'DemoPassw0rd!23';
const PEOPLE = [
  // `unit` lives on the MEMBERSHIP, not the user — guards and admins hold no
  // unit, which is why it is per-person here rather than a global.
  { role: 'resident', email: 'resident@estate-access-qa.com', name: 'Rita Resident', unit: 'B12' },
  { role: 'guard', email: 'guard@estate-access-qa.com', name: 'Gary Guard' },
  { role: 'admin', email: 'admin@estate-access-qa.com', name: 'Ada Admin' },
];

async function findUserByEmail(email) {
  const { body } = await api(`/auth/v1/admin/users?per_page=200`, { method: 'GET' });
  return (body?.users ?? []).find((u) => u.email === email) ?? null;
}

async function reset() {
  console.log('Resetting…');
  for (const t of ['access_codes', 'verification_events', 'memberships']) {
    await api(`/rest/v1/${t}?estate_id=eq.${ESTATE_ID}`, { method: 'DELETE' });
  }
  await api(`/rest/v1/estates?id=eq.${ESTATE_ID}`, { method: 'DELETE' });
  for (const p of PEOPLE) {
    const u = await findUserByEmail(p.email);
    if (u) await api(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
  }
}

async function main() {
  if (process.argv.includes('--reset')) await reset();

  const est = await api('/rest/v1/estates', {
    body: { id: ESTATE_ID, name: ESTATE_NAME },
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  });
  if (est.status >= 300) die(`Creating estate failed: ${est.status} ${JSON.stringify(est.body)}`);
  console.log(`✔ estate  ${ESTATE_NAME} (${ESTATE_ID})`);

  for (const p of PEOPLE) {
    let created = await api('/auth/v1/admin/users', {
      body: {
        email: p.email,
        password: PASSWORD,
        email_confirm: true, // no confirmation mail — the built-in SMTP is rate limited
        user_metadata: { full_name: p.name },
      },
    });
    let user = created.body?.id ? created.body : await findUserByEmail(p.email);
    if (!user?.id) die(`Creating ${p.email} failed: ${created.status} ${JSON.stringify(created.body)}`);

    // `on_conflict` is required, not optional: merge-duplicates alone only
    // resolves against the PRIMARY KEY, so re-running the seed collided with
    // memberships_user_estate_role_key and died with 23505. Naming the unique
    // constraint's columns is what makes this idempotent.
    const m = await api('/rest/v1/memberships?on_conflict=user_id,estate_id,role', {
      body: { user_id: user.id, estate_id: ESTATE_ID, role: p.role, unit: p.unit ?? null },
      headers: { Prefer: 'resolution=merge-duplicates' },
    });
    if (m.status >= 300) die(`Membership for ${p.email} failed: ${m.status} ${JSON.stringify(m.body)}`);
    console.log(`✔ ${p.role.padEnd(8)} ${p.email}`);
  }

  console.log(`\nPassword for all three: ${PASSWORD}\n`);
}

main();
