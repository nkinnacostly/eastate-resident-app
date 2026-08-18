/**
 * Fails if a workspace imports a package it does not declare.
 *
 * npm hoists every workspace's dependencies into the root node_modules, so an
 * undeclared import resolves perfectly on a developer machine and perfectly in
 * a full `npm install` at the repo root. It only breaks where the install is
 * scoped to one workspace — which is exactly what a deploy does. That is how
 * apps/web shipped importing @estate/core, @estate/db and @supabase/supabase-js
 * while declaring none of them: every local build passed, and the first clean
 * scoped install failed with `Cannot find module`.
 *
 * A local build cannot catch this by construction. This check can.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'ios', 'android', '.expo', '.next', 'coverage']);
const SOURCE = /\.(m?[jt]sx?|cjs)$/;
const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** `from 'x'`, `import 'x'`, `require('x')`, `import('x')` */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

/**
 * Prose in comments trips the specifier regex — "different from 'never heard
 * of it'" reads as an import. Strip comments first, stepping over string
 * literals so a `//` inside a URL or a `/*` inside a "@/*" path alias is not
 * mistaken for a comment opener.
 */
const stripComments = (src) => {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      while (++i < src.length) {
        out += src[i];
        if (src[i] === '\\') { out += src[++i] ?? ''; continue; }
        if (src[i] === quote) break;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return out;
};

/**
 * npm package names: an optional @scope/ then a name. `@/lib` has an empty
 * scope, so it is a path alias rather than a package no matter what any
 * tsconfig says.
 */
const isPackageName = (name) => /^(?:@[^/@\s]+\/)?[^/@\s.][^/@\s]*$/.test(name);

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(entry)) out.push(full);
  }
  return out;
};

/** '@scope/pkg/sub' -> '@scope/pkg'; 'pkg/sub' -> 'pkg' */
const packageOf = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

const workspaceDirs = () => {
  const globs = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).workspaces ?? [];
  return globs.flatMap((g) => {
    const parent = join(ROOT, g.replace(/\/\*$/, ''));
    return g.endsWith('/*')
      ? readdirSync(parent).map((d) => join(parent, d)).filter((d) => statSync(d).isDirectory())
      : [parent];
  });
};

let failures = 0;

for (const dir of workspaceDirs()) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }

  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    pkg.name,
  ]);

  // tsconfig path aliases are internal, not packages.
  const aliases = (() => {
    try {
      const raw = readFileSync(join(dir, 'tsconfig.json'), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm, '');
      return Object.keys(JSON.parse(raw).compilerOptions?.paths ?? {}).map((p) => p.replace(/\/?\*$/, ''));
    } catch {
      return [];
    }
  })();

  const missing = new Map();

  for (const file of walk(dir)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const [, spec] of text.matchAll(SPECIFIER)) {
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      if (BUILTIN.has(spec) || BUILTIN.has(packageOf(spec))) continue;
      if (aliases.some((a) => spec === a || spec.startsWith(`${a}/`))) continue;
      const name = packageOf(spec);
      if (!isPackageName(name) || declared.has(name)) continue;
      if (!missing.has(name)) missing.set(name, relative(ROOT, file));
    }
  }

  if (missing.size) {
    failures += missing.size;
    console.error(`\n  ${pkg.name} (${relative(ROOT, dir)}) imports but does not declare:`);
    for (const [name, where] of missing) console.error(`    ${name.padEnd(28)} first seen in ${where}`);
  }
}

if (failures) {
  console.error(`\n${failures} undeclared dependenc${failures === 1 ? 'y' : 'ies'}.`);
  console.error('Add them to that workspace\'s package.json — a scoped install (i.e. a deploy) will not hoist them.\n');
  process.exit(1);
}
console.log('every workspace declares what it imports');
