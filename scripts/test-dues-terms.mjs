#!/usr/bin/env node
/**
 * The term the Edge Functions accept and the line the payer sees at checkout.
 *
 * Imports the real Deno module (plain TS, no Deno APIs) so the code under test
 * is the code that ships. The failure that matters most is a bad term quietly
 * becoming 1 month: the payer chose a year and would be charged for one month.
 */
import assert from 'node:assert/strict';

const { parseTerm, termDescription } = await import('../supabase/functions/_shared/money.ts');

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('no term means one month', () => assert.equal(parseTerm(undefined), 1));
test('each supported term is accepted', () => {
  for (const n of [1, 3, 6, 12]) assert.equal(parseTerm(n), n);
});
test('a numeric string is accepted (a form field)', () => assert.equal(parseTerm('6'), 6));
test('an unsupported term is REFUSED, not coerced to 1', () => {
  for (const bad of [2, 0, -3, 24, 'year', 3.5, {}]) assert.equal(parseTerm(bad), null, String(bad));
});
test('one month reads as monthly dues', () =>
  assert.equal(termDescription(1, '2027-01-01', '2027-01-01'), 'Monthly estate dues'));
test('a term names its months', () =>
  assert.equal(termDescription(3, '2027-01-01', '2027-03-01'), 'Estate dues, 3 months (Jan 2027 – Mar 2027)'));
// "Sep" or "Sept" depending on the ICU build -- Deno and Node disagree.
test('a year spans the turn of the year', () =>
  assert.match(termDescription(12, '2026-10-01', '2027-09-01'),
    /^Estate dues, 12 months \(Oct 2026 – Sept? 2027\)$/));

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
