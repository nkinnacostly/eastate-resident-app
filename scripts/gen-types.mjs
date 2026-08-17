#!/usr/bin/env node
/**
 * Regenerate packages/db/src/types.ts.
 *
 * A wrapper rather than a plain `supabase gen types > types.ts`, because the
 * shell truncates the target BEFORE the command runs: one network blip and the
 * checked-in types file is replaced by a one-line error blob, with the previous
 * contents gone from the working tree. That happened. This writes to a buffer,
 * checks the output actually looks like the generated module, and only then
 * touches the file.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'db', 'src', 'types.ts');
const args = process.argv.slice(2);

let out;
try {
  out = execFileSync('supabase', ['gen', 'types', 'typescript', ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // stderr stays on the terminal: the CLI puts its warnings there, and
    // swallowing them is how a deprecation notice goes unnoticed for months.
    stdio: ['ignore', 'pipe', 'inherit'],
  });
} catch (e) {
  console.error(`\n✗ type generation failed — ${target} left untouched.`);
  process.exit(e.status ?? 1);
}

// The CLI exits 0 while printing a JSON error blob, so the exit code alone is
// not evidence of success.
if (!out.includes('export type Database')) {
  console.error(`\n✗ output does not look like generated types — ${target} left untouched.\n`);
  console.error(out.slice(0, 500));
  process.exit(1);
}

writeFileSync(target, out);
console.log(`✓ wrote ${out.split('\n').length} lines to packages/db/src/types.ts`);
