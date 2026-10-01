#!/usr/bin/env node
/**
 * Do the detail RPCs return every key the web pages read?
 *
 * Both sides are derived, neither is hand-listed: the keys come from running
 * the real migrations and RPCs (supabase/tests/detail-contract.sql prints them)
 * and the expectations come from parsing the interfaces in
 * apps/web/src/lib/detail.ts with the TypeScript compiler. A required property
 * the RPC never returns is a field that renders blank -- invisible to tsc,
 * because the RPC's return type is just `Json`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const chain = pkg.scripts['test:detail-views'].split(' ').slice(2); // drop `node scripts/test-migration.mjs`
const run = spawnSync('node', ['scripts/test-migration.mjs', ...chain, 'supabase/tests/detail-contract.sql'], {
  encoding: 'utf8',
  env: { ...process.env, PATH: `/usr/bin:${process.env.PATH}` },
});
if (run.status !== 0) {
  console.error(run.stdout, run.stderr);
  process.exit(1);
}

// label -> Set(keys)
const actual = new Map();
for (const line of run.stdout.split('\n')) {
  const m = line.match(/^PASS {2}contract (\S+) (\S*)$/);
  if (m) actual.set(m[1], new Set(m[2] ? m[2].split(',') : []));
}
if (actual.size === 0) {
  console.error('No contract output -- the SQL side has drifted. Failing rather than passing vacuously.');
  process.exit(1);
}

// ─── The TypeScript side ─────────────────────────────────────────────────────
const file = 'apps/web/src/lib/detail.ts';
const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const interfaces = new Map();
src.forEachChild((n) => {
  if (ts.isInterfaceDeclaration(n)) interfaces.set(n.name.text, n.members);
});

// label -> [{ key, optional }]
const expected = new Map();
function walk(label, members) {
  const props = [];
  for (const m of members) {
    if (!ts.isPropertySignature(m) || !m.type) continue;
    const key = m.name.getText(src);
    props.push({ key, optional: Boolean(m.questionToken) });
    visitType(`${label}.${key}`, m.type);
  }
  expected.set(label, props);
}
function visitType(label, t) {
  if (ts.isTypeLiteralNode(t)) return walk(label, t.members);
  if (ts.isArrayTypeNode(t)) return visitType(`${label}[]`, t.elementType);
  if (ts.isTypeReferenceNode(t) && interfaces.has(t.typeName.getText(src))) {
    return walk(label, interfaces.get(t.typeName.getText(src)));
  }
}

const roots = [...actual.keys()].filter((l) => !l.includes('.') && !l.includes('['));
for (const r of roots) {
  if (!interfaces.has(r)) {
    console.error(`FAIL  ${r}: no interface of that name in ${file}`);
    process.exit(1);
  }
  walk(r, interfaces.get(r));
}

let failed = 0;
let checked = 0;
const unverified = [];
for (const [label, props] of expected) {
  const got = actual.get(label);
  if (!got) {
    unverified.push(label);
    continue;
  }
  const missing = props.filter((p) => !p.optional && !got.has(p.key)).map((p) => p.key);
  checked++;
  if (missing.length) {
    failed++;
    console.log(`FAIL  ${label}: page reads ${missing.join(', ')} -- the RPC does not return ${missing.length > 1 ? 'them' : 'it'}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}
// An empty array in the fixture leaves its element shape unproven. Say so
// rather than count it as checked.
for (const u of unverified) console.log(`SKIP  ${u} (no sample in the fixture)`);
console.log(`\n${checked - failed}/${checked} shapes match${unverified.length ? `, ${unverified.length} unproven` : ''}`);
process.exit(failed || unverified.length ? 1 : 0);
