#!/usr/bin/env node
/**
 * Every query the apps actually make, run against the real database.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 *
 * On 27 Sep 2026 a one-line migration added an audit column as a foreign key
 * to `memberships`. `memberships.estate_id` already pointed the other way, so
 * there were suddenly TWO relationships between `memberships` and `estates`.
 * PostgREST resolves an embed like `estates(name)` by finding THE key between
 * two tables; with two it refuses, `HTTP 300 PGRST201`.
 *
 * All three clients embed that way at startup. So one audit column broke login
 * on the admin dashboard, the resident app AND the guard app simultaneously --
 * and it took the gate offline, because a guard with no resolved post is
 * bounced off the keypad and never binds the offline pool.
 *
 * IT PASSED EVERY TEST WE HAD. The migration applied cleanly, every SQL
 * invariant passed, the types compiled. The schema was correct and the product
 * would not open, because nothing here had ever asked PostgREST -- the layer
 * the apps actually talk to -- whether it could answer.
 *
 * ─── What it does ───────────────────────────────────────────────────────────
 *
 * Extracts every `.from('table').select('...')` from the app sources and runs
 * each one against the linked project as a real signed-in user. It does not
 * keep its own list of queries, deliberately: a hand-maintained list drifts the
 * first time someone adds a screen, and the whole failure here was a gap
 * between what the code did and what the tests believed it did.
 *
 * The filters are dropped and `limit=0` applied. Ambiguity, unknown columns and
 * missing grants all resolve when PostgREST PLANS the query, so a zero-row
 * request proves what we need without depending on fixture data.
 *
 * WHAT IT CANNOT DO: prove a policy returns the right ROWS. That is
 * supabase/tests/invariants.sql. This answers "can the app talk to the database
 * at all", which is the question nothing was asking.
 *
 *     npm run test:client-queries
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error('Need EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and '
    + 'SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(2);
}

// ─── Find the queries ────────────────────────────────────────────────────────

const ROOTS = ['apps/web/src', 'apps/resident', 'apps/guard', 'packages'];
const SKIP = new Set(['node_modules', '.expo', 'dist', 'build', '.next']);

function sources() {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (SKIP.has(e)) continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e)) out.push(p);
    }
  };
  for (const r of ROOTS) { try { walk(r); } catch { /* optional root */ } }
  return out;
}

// `.from('x')` then `.select('y')`, tolerating chained calls and newlines
// between them. Template literals are skipped: a select built at runtime is not
// a static fact this test can check.
const RE = /\.from\(\s*'([a-z_]+)'\s*\)([\s\S]{0,400}?)\.select\(\s*(['"])([\s\S]*?)\3/g;

// Every `.rpc('name')` too. A renamed or never-deployed function fails the
// same way a bad embed does -- at runtime, in front of a user -- and is just
// as invisible to a typecheck, because the generated types are regenerated
// from whatever the database currently has.
const RPC_RE = /\.rpc[<(][^'"`]{0,80}?['"]([a-z_0-9]+)['"]/g;

const queries = [];
const rpcs = new Map();
for (const file of sources()) {
  const src = readFileSync(file, 'utf8');
  let m;
  while ((m = RE.exec(src))) {
    queries.push({
      file,
      line: src.slice(0, m.index).split('\n').length,
      table: m[1],
      select: m[4].replace(/\s*\n\s*/g, ' ').trim(),
    });
  }
  let r;
  while ((r = RPC_RE.exec(src))) {
    if (!rpcs.has(r[1])) {
      rpcs.set(r[1], `${file}:${src.slice(0, r.index).split('\n').length}`);
    }
  }
}

if (queries.length === 0) {
  console.error('Extracted zero queries — the pattern has drifted. Failing rather than '
    + 'reporting a vacuous pass.');
  process.exit(1);
}

// ─── A throwaway signed-in user ──────────────────────────────────────────────
//
// A real `authenticated` session, not the service role: the service role
// bypasses RLS and would hide a missing GRANT, which is the other half of what
// breaks a query at this layer.

const admin = (path, opts = {}) =>
  fetch(`${URL_}${path}`, {
    ...opts,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
               'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });

const email = `qa-client-queries-${Date.now()}@estate-qa.local`;
const password = `qa-${crypto.randomUUID()}`;

const made = await admin('/auth/v1/admin/users', {
  method: 'POST',
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!made.ok) {
  console.error('Could not create the QA user:', made.status, await made.text());
  process.exit(1);
}
const userId = (await made.json()).id;

let failed = 0;
try {
  const tok = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await tok.json();
  if (!session.access_token) throw new Error(`sign-in failed: ${JSON.stringify(session)}`);

  const H = { apikey: ANON, Authorization: `Bearer ${session.access_token}` };

  console.log(`Running ${queries.length} client queries against ${URL_}\n`);

  for (const q of queries) {
    const url = `${URL_}/rest/v1/${q.table}`
      + `?select=${encodeURIComponent(q.select)}&limit=0`;
    const res = await fetch(url, { headers: H });

    if (res.ok) {
      console.log(`PASS  ${q.table.padEnd(22)} ${q.file}:${q.line}`);
      continue;
    }

    failed++;
    const body = await res.json().catch(() => ({}));
    console.log(`FAIL  ${q.table.padEnd(22)} ${q.file}:${q.line}`);
    console.log(`      HTTP ${res.status} ${body.code ?? ''} — ${body.message ?? ''}`);
    console.log(`      select: ${q.select}`);
    // PGRST201 is the one that broke everything, so name it and say what to do.
    if (body.code === 'PGRST201') {
      console.log('      → Two relationships between these tables. Name the constraint,');
      console.log('        e.g. estates!memberships_estate_id_fkey(name). See');
      console.log('        supabase/tests/embeds.sql.');
    }
    if (body.code === '42501') {
      console.log('      → RLS policy without a matching GRANT: Postgres checks table');
      console.log('        privileges BEFORE policies.');
    }
  }

  // ─── The RPCs ──────────────────────────────────────────────────────────────
  //
  // Checked against PostgREST's own OpenAPI schema, which is the list of what
  // is actually REACHABLE through the API -- exactly the question being asked.
  //
  // NOT by calling each one: a first attempt did that and reported nine
  // healthy functions as missing. PostgREST answers `404 PGRST202` both when a
  // function does not exist AND when it exists with different parameters than
  // you sent, so calling with no arguments makes every function that takes
  // arguments look deleted. A test that cries wolf is worse than no test.
  //
  // Two questions, because this codebase has shipped both failures:
  //   1. Is it deployed at all?          (service role sees everything)
  //   2. Can a signed-in user call it?   (a definer function that was never
  //                                       granted to `authenticated` 404s at
  //                                       runtime for every real user)
  //
  // The second needs the catalog, not the API: this project does not serve the
  // OpenAPI schema to anything but the service role -- good posture, and it
  // means privileges have to be read from pg_proc through the CLI.
  const schemaFor = async (key, bearer) => {
    const r = await fetch(`${URL_}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${bearer}`,
                 Accept: 'application/openapi+json' },
    });
    if (!r.ok) throw new Error(`OpenAPI schema unavailable: ${r.status}`);
    const j = await r.json();
    return new Set(
      Object.keys(j.paths ?? {}).filter((x) => x.startsWith('/rpc/')).map((x) => x.slice(5)),
    );
  };

  const deployed = await schemaFor(SERVICE, SERVICE);

  const names = [...rpcs.keys()];
  const sql = `select p.proname,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (${
       names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',')})`;

  const out = spawnSync('npx', ['supabase', 'db', 'query', '--linked', sql],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  // The CLI pretty-prints, so the object starts `{\n  "boundary"` -- match the
  // first brace rather than a literal, and skip the "Initialising login role"
  // line it writes to stderr.
  const json = (out.stdout ?? '').slice((out.stdout ?? '').indexOf('{'));
  let callable;
  try {
    // A function can be overloaded, so ANY signature the app might reach being
    // callable is what counts -- hence the OR across rows of the same name.
    const rows = JSON.parse(json).rows;
    callable = new Set(rows.filter((r) => r.authenticated).map((r) => r.proname));
  } catch {
    console.error('Could not read function privileges from the database. '
      + 'Is the project linked?');
    console.error(out.stderr?.slice(0, 400));
    throw new Error('privilege check unavailable');
  }

  console.log(`\nChecking ${rpcs.size} RPCs the apps call `
    + `(${deployed.size} deployed, ${callable.size} callable by a signed-in user)\n`);

  for (const [name, where] of rpcs) {
    if (!deployed.has(name)) {
      failed++;
      console.log(`FAIL  ${name.padEnd(34)} ${where}`);
      console.log('      Not deployed, or renamed since this call site was written.');
    } else if (!callable.has(name)) {
      failed++;
      console.log(`FAIL  ${name.padEnd(34)} ${where}`);
      console.log('      Deployed but NOT callable by `authenticated` — the app will get a');
      console.log('      404 at runtime. Needs GRANT EXECUTE ... TO authenticated.');
    } else {
      console.log(`PASS  ${name.padEnd(34)} ${where}`);
    }
  }
} finally {
  // Always, even on a throw. A QA account left behind on a production auth
  // table is a real account somebody could later sign in to.
  const gone = await admin(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
  console.log(`\n${gone.ok ? 'Removed' : '⚠️  COULD NOT REMOVE'} the QA user ${email}`);
}

const total = queries.length + rpcs.size;
console.log(`\n${total - failed}/${total} checks passed `
  + `(${queries.length} queries, ${rpcs.size} RPCs)`);
process.exit(failed === 0 ? 0 : 1);

console.log(`\n${queries.length - failed}/${queries.length} client queries answered`);
process.exit(failed === 0 ? 0 : 1);
