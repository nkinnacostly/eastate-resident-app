#!/usr/bin/env node
/**
 * Run supabase/tests/security.sql against the linked project.
 *
 *   node scripts/test-security.mjs                       # the schema as deployed
 *   node scripts/test-security.mjs --with <migration> [--with <migration>…]
 *                                                        # dry run: migrations + tests, rolled back
 *
 * The dry run splices the migration in after the suite's opening `begin;`, so
 * it is applied to the REAL schema, tested as the real roles, and rolled back
 * with the fixtures. That is the only way to test a migration that changes
 * grants, policies and auth.users together: the local harness
 * (scripts/test-migration.mjs) has no roles' real privileges to test against.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const suite = readFileSync('supabase/tests/security.sql', 'utf8');
// Every `--with <file>` is spliced in, in the order given.
const withFiles = process.argv.flatMap((a, i, all) => (a === '--with' ? [all[i + 1]] : []));
let sql = suite;
if (withFiles.length) {
  if (!suite.includes('-- @@MIGRATION@@')) throw new Error('no splice marker in security.sql');
  const migrations = withFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  // A function, not a string: a replacement string treats $$ as an escape for $,
  // which silently corrupts every dollar-quoted function body in the migration.
  sql = suite.replace('-- @@MIGRATION@@', () => migrations);
  console.log(`dry run: ${withFiles.join(', ')} (rolled back)\n`);
}

const file = join(mkdtempSync(join(tmpdir(), 'sec-')), 'security.sql');
writeFileSync(file, sql);

// The CLI's connection to the Management API fails TLS intermittently here
// ("bad record MAC"); that is transport, not a test result, so retry it.
let out = '';
for (let attempt = 1; attempt <= 4; attempt++) {
  const r = spawnSync('supabase', ['db', 'query', '--linked', '-f', file], { encoding: 'utf8' });
  out = `${r.stdout}\n${r.stderr}`;
  if (r.status === 0 || !/bad record MAC|TransportError|connection reset/i.test(out)) break;
}

const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
let rows = null;
try { rows = JSON.parse(json).rows; } catch { /* an error, printed below */ }

if (!rows) {
  const failed = out.match(/FAILED:[\s\S]*?(?="|\n\S)/)?.[0];
  console.log(failed ? failed.replace(/\\n/g, '\n') : out.trim());
  process.exit(1);
}
for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.pass ? `\n      ${r.detail}` : ''}`);
const failed = rows.filter((r) => !r.pass).length;
console.log(`\n${rows.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
