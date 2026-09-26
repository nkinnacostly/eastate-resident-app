#!/usr/bin/env node
/**
 * Run a migration and its invariants against a throwaway Postgres.
 *
 * Why this exists rather than `supabase db start`: that needs Docker, and this
 * machine has none. The alternative was pushing an untested migration at
 * production to find out whether it parses, which is not an alternative. The
 * first run of the retention migration failed on `GET DIAGNOSTICS x = x + n`
 * -- valid-looking plpgsql that Postgres rejects -- and that is exactly the
 * class of error no amount of reading the file catches.
 *
 * It is NOT a substitute for `npm run test:db`. That suite runs against the
 * real schema with RLS, real roles and real policies; this runs a hand-written
 * stand-in containing only the tables the migration under test touches. It
 * answers "does this migration do what it claims", not "is the system correct".
 *
 * Usage:
 *   node scripts/test-migration.mjs <harness.sql> <migration.sql> <invariants.sql>
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A fixed port collides with a leftover instance from a previous run and the
// failure reads as "the migration is broken", which it is not.
const PORT = 50000 + Math.floor(Math.random() * 10000);
const DB = 'migration_test';

// Homebrew keeps versioned Postgres off PATH. Fall back to whatever is on it.
const PG_BIN = ['/opt/homebrew/opt/postgresql@14/bin', '/opt/homebrew/bin', '/usr/local/bin'].find(
  (d) => existsSync(join(d, 'initdb')),
);

const [harness, migration, invariants] = process.argv.slice(2);
if (!harness || !migration || !invariants) {
  console.error('usage: test-migration.mjs <harness.sql> <migration.sql> <invariants.sql>');
  process.exit(2);
}
if (!PG_BIN) {
  console.error('No local Postgres found. `brew install postgresql@14`.');
  process.exit(2);
}

const bin = (name) => join(PG_BIN, name);
const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: 'utf8', ...opts });

// Listen on TCP, not a unix socket: the socket path is capped at 103 bytes and
// a scratch directory under the session temp dir blows straight past it.
const SERVER_OPTS = `-p ${PORT} -h 127.0.0.1 -c unix_socket_directories=''`;

let dataDir;
let started = false;
try {
  dataDir = await mkdtemp(join(tmpdir(), 'pgmig-'));

  const init = run(bin('initdb'), ['-D', dataDir, '-U', 'postgres', '--auth=trust']);
  if (init.status !== 0) throw new Error(`initdb failed:\n${init.stderr}`);

  const up = run(bin('pg_ctl'), ['-D', dataDir, '-o', SERVER_OPTS, '-l', join(dataDir, 'log'), '-w', 'start']);
  if (up.status !== 0) throw new Error(`pg_ctl start failed:\n${up.stdout}${up.stderr}`);
  started = true;

  const psql = (args) =>
    run(bin('psql'), ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', ...args]);

  const created = psql(['-c', `create database ${DB};`]);
  if (created.status !== 0) throw new Error(created.stderr);

  for (const [label, file] of [
    ['harness', harness],
    ['migration', migration],
    ['invariants', invariants],
  ]) {
    const r = psql(['-d', DB, '-f', file]);
    // psql sends RAISE NOTICE to stderr, so PASS lines arrive there too.
    const out = `${r.stdout}${r.stderr}`;
    for (const line of out.split('\n')) {
      if (/PASS|FAIL|ERROR/.test(line)) console.log(line.replace(/^.*?(NOTICE|ERROR):\s*/, '').trim());
    }
    if (r.status !== 0) {
      console.error(`\n${label} failed:\n${out}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log('\nAll invariants passed.');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  if (started) run(bin('pg_ctl'), ['-D', dataDir, '-m', 'immediate', '-w', 'stop']);
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
}
