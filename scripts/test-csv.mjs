/**
 * Tests for the estate-roll CSV reader.
 *
 * Run with:  npm run test:csv
 *
 * WHY THIS IS A SCRIPT AND NOT A TEST RUNNER
 *
 * apps/web has no test runner, and adding one means adding a dependency, which
 * means regenerating package-lock.json. That lockfile has already cost this
 * project once: a regeneration dropped 31 of 33 optional platform binaries,
 * including all 17 Linux ones, and broke `npm ci` on Vercel. Node 26 strips
 * TypeScript natively, so the module under test can be imported directly and
 * this costs nothing.
 *
 * If apps/web ever gains vitest, move these over and delete this file.
 *
 * WHAT IS WORTH TESTING HERE
 *
 * Not "does it split on commas". The failures that matter all come from the
 * file being real: exported by Excel with a byte order mark, by Sheets with
 * CRLF, by a levy system with a column called Erf, or pasted as a bare list
 * with no header at all. Each of those reads as valid CSV and produces wrong
 * houses, which is worse than an error.
 */
import { parseCsv, readHouses, toCsv, slugFilename } from '../apps/web/src/lib/csv.ts';

let pass = 0;
const failures = [];

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    pass++;
  } else {
    failures.push(`${name}\n      got:  ${a}\n      want: ${b}`);
  }
}

function group(name, fn) {
  console.log(`\n${name}`);
  const before = failures.length;
  const from = pass;
  fn();
  const ran = pass - from + (failures.length - before);
  console.log(`  ${pass - from}/${ran}`);
}

// ─── parseCsv ────────────────────────────────────────────────────────────────

group('parseCsv — shapes a spreadsheet actually exports', () => {
  eq('plain', parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  eq('CRLF (Excel, Sheets)', parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  // Without this the first header becomes "﻿house" and silently unmatches.
  eq('leading BOM stripped', parseCsv('﻿house\n14'), [['house'], ['14']]);
  eq('quoted comma', parseCsv('a\n"1,2"'), [['a'], ['1,2']]);
  eq('escaped quote', parseCsv('a\n"he said ""hi"""'), [['a'], ['he said "hi"']]);
  eq('newline inside quotes', parseCsv('a\n"line1\nline2"'), [['a'], ['line1\nline2']]);
  // Spreadsheets export trailing blank lines constantly; each one would
  // otherwise become an "invalid" row and make a clean file look broken.
  eq('blank rows dropped', parseCsv('a\n\n\n1\n'), [['a'], ['1']]);
  eq('no trailing newline', parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  eq('empty fields preserved', parseCsv('a,b,c\n1,,3'), [['a', 'b', 'c'], ['1', '', '3']]);
});

// ─── readHouses ──────────────────────────────────────────────────────────────

group('readHouses — headers', () => {
  const r = readHouses(parseCsv('House Number,Landlord Name,Cell\n14,Thabo,0821234567\n15,,'));
  eq('header detected', r.hadHeader, true);
  eq('mapped from header', r.mapping.house_number, 'House Number');
  eq('rows', r.houses, [
    { house_number: '14', landlord_name: 'Thabo', landlord_phone: '0821234567', landlord_email: undefined },
    { house_number: '15', landlord_name: undefined, landlord_phone: undefined, landlord_email: undefined },
  ]);

  const erf = readHouses(parseCsv('Erf,Owner\n221B,Holmes'));
  eq('erf / owner aliases', erf.houses[0].house_number, '221B');
  eq('owner -> landlord_name', erf.houses[0].landlord_name, 'Holmes');
});

group('readHouses — bare list with no header', () => {
  // The likeliest input: a column pasted out of a levy statement.
  const r = readHouses(parseCsv('12A\n12B\n13'));
  eq('no header claimed', r.hadHeader, false);
  eq('row 1 is data, not a header', r.houses.map((h) => h.house_number), ['12A', '12B', '13']);
});

group('readHouses — header we only partly understand', () => {
  // The dangerous case. "Ref,Phone" matches on phone, so row 1 is eaten as a
  // header, but nothing maps to house_number -- every row would be skipped and
  // the admin told the file has no house numbers when it plainly does.
  const r = readHouses(parseCsv('Ref,Phone\n14,082\n15,083'));
  eq('still treated as a header', r.hadHeader, true);
  eq('house number recovered', r.houses.map((h) => h.house_number), ['14', '15']);
  eq('phone still mapped', r.houses[0].landlord_phone, '082');
  eq('the guess is labelled', r.mapping.house_number, 'Ref (assumed)');
  eq('nothing skipped', r.skipped, []);

  // The fallback must take a FREE column, never one already mapped.
  const s = readHouses(parseCsv('Phone,Something\n082,14'));
  eq('does not steal the phone column', s.houses.map((h) => h.house_number), ['14']);
  eq('phone survives', s.houses[0].landlord_phone, '082');
});

group('readHouses — messy input', () => {
  const r = readHouses(parseCsv('house,phone\n 14 , 082 \n,orphan\n16,'));
  eq('cells trimmed', r.houses[0].house_number, '14');
  eq('row with no house number skipped', r.skipped, [3]);
  eq('by file line, not row index', r.houses.length, 2);
  eq('empty file', readHouses([]).houses, []);
});

// ─── toCsv ───────────────────────────────────────────────────────────────────

group('toCsv', () => {
  eq('quotes only when needed', toCsv([['a,b', 'plain']]), '"a,b",plain');
  eq('doubles inner quotes', toCsv([['say "hi"']]), '"say ""hi"""');
  eq('null and undefined are empty', toCsv([[null, undefined, 'x']]), ',,x');
  eq('CRLF between rows', toCsv([['a'], ['b']]), 'a\r\nb');

  // Excel executes a leading =, +, - or @. A house legitimately numbered -12
  // would run rather than display, and a landlord name is attacker-controlled
  // text heading straight into whoever opens the export.
  eq('formula injection neutralised', toCsv([['=cmd|calc']]), "'=cmd|calc");
  eq('leading minus neutralised', toCsv([['-12']]), "'-12");
  eq('leading plus neutralised', toCsv([['+1']]), "'+1");
  eq('leading at neutralised', toCsv([['@SUM']]), "'@SUM");
});

group('slugFilename', () => {
  eq('slugged', slugFilename('Acacia Park!', 'house-codes'), 'acacia-park-house-codes.csv');
  eq('falls back when nameless', slugFilename('', 'house-codes'), 'estate-house-codes.csv');
});

// ─── report ──────────────────────────────────────────────────────────────────

console.log('');
if (failures.length === 0) {
  console.log(`${pass} passed`);
} else {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
