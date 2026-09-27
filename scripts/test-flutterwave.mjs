#!/usr/bin/env node
/**
 * Exercises the Flutterwave client against the real sandbox.
 *
 * Two kinds of test here, and the distinction matters:
 *
 *   PURE     — amount conversion, redaction, the constant-time compare. These
 *              are where money bugs hide and they need no network.
 *   LIVE     — a real POST to Flutterwave's test API. These prove the request
 *              SHAPE is right, which no amount of local testing can: their docs
 *              contradict themselves on field names in three places, so the
 *              only authority on what the API accepts is the API.
 *
 * Runs against test keys only. It refuses to start on a live key, because a
 * live key here would create real checkout sessions.
 *
 * What this CANNOT do: complete a payment. That needs a human on the hosted
 * page entering a card. The settlement logic is therefore tested exhaustively
 * in SQL instead (npm run test:dues, 52 invariants) and the webhook handler
 * against recorded payloads (npm run test:webhook).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

// ─── Which key, and the refusal that protects the live account ──────────────
//
// FLUTTERWAVE_TEST_SECRET_KEY first, so the app can hold LIVE keys while the
// tests keep a sandbox one. Once live keys go into .env.local there is
// otherwise no test key left anywhere and this whole suite goes dark --
// exactly when payments start mattering most.
//
// A live key here would create REAL checkout sessions and REAL subaccounts
// against the estate's own bank details. The suite refuses rather than trusts
// itself to stay read-only.
const KEY = env.FLUTTERWAVE_TEST_SECRET_KEY || env.FLUTTERWAVE_SECRET_KEY;

if (!KEY) {
  console.error('No Flutterwave key in .env.local '
    + '(FLUTTERWAVE_TEST_SECRET_KEY or FLUTTERWAVE_SECRET_KEY).');
  process.exit(2);
}

if (!KEY.includes('_TEST')) {
  // Skipped, not failed, and loudly. A hard failure here makes `npm run
  // test:all` permanently red the day live keys land, and a suite that is
  // always red is a suite people stop reading. Exit 0 so the rest of the run
  // still reports, but make the gap impossible to miss.
  console.error('');
  console.error('  ████  FLUTTERWAVE TESTS SKIPPED  ████');
  console.error('');
  console.error('  The only Flutterwave key available is a LIVE key, and this suite');
  console.error('  creates checkout sessions and subaccounts. Running it against live');
  console.error('  credentials would move real money and touch real bank details.');
  console.error('');
  console.error('  PAYMENTS ARE NOW UNTESTED. To restore coverage, put a sandbox key in');
  console.error('  .env.local as FLUTTERWAVE_TEST_SECRET_KEY — it sits alongside the live');
  console.error('  FLUTTERWAVE_SECRET_KEY and is used only by tests.');
  console.error('');
  process.exit(0);
}

// The shared client is Deno source. Shim the one global it touches rather than
// weakening the production module for the benefit of a test.
globalThis.Deno = { env: { get: (k) => env[k] } };

const fw = await import('../supabase/functions/_shared/flutterwave.ts');

let pass = 0;
let fail = 0;
const ok = (label, cond) => {
  if (cond) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}`);
  }
};

// ─── Pure: money conversion ──────────────────────────────────────────────────

console.log('\n— amount conversion —');
ok('minor to major', fw.toMajor(2500000) === 25000);
ok('major to minor', fw.toMinor(25000) === 2500000);
ok('round trip is lossless', fw.toMinor(fw.toMajor(2500000)) === 2500000);
ok('handles kobo', fw.toMajor(250050) === 2500.5 && fw.toMinor(2500.5) === 250050);

// The reason toMinor goes via Number(x).toFixed rather than x * 100:
// 25000.07 * 100 is 2500006.9999999995 in binary floating point. A naive
// multiply-and-truncate here loses a kobo, and a kobo short fails the amount
// check and refuses a legitimate payment.
ok('no floating point drift at .07', fw.toMinor(25000.07) === 2500007);
ok('no drift at .29', fw.toMinor(1.29) === 129);
ok('accepts a string amount', fw.toMinor('2500.50') === 250050);

// ─── Pure: the webhook secret compare ────────────────────────────────────────

console.log('\n— verif-hash compare —');
ok('matching secret passes', fw.secretMatches('s3cret', 's3cret'));
ok('wrong secret fails', !fw.secretMatches('s3cret', 'other!'));
ok('prefix does not pass', !fw.secretMatches('s3c', 's3cret'));
ok('longer does not pass', !fw.secretMatches('s3cretx', 's3cret'));
ok('absent header fails', !fw.secretMatches(null, 's3cret'));
// If the secret were ever unset, a plain === would make '' === '' true and
// wave every request through.
ok('unset expected secret fails closed', !fw.secretMatches('anything', undefined));
ok('empty header fails', !fw.secretMatches('', ''));

// ─── Live: create a hosted checkout ──────────────────────────────────────────

console.log('\n— live sandbox: subaccounts —');

// Every checkout below needs a REAL subaccount, because createCheckout now
// refuses to build a charge without one. That refusal is the whole feature:
// estate dues settle into the estate's own bank account and never into ours.
//
// Created here and deleted at the end, so a test run leaves the Flutterwave
// account exactly as it found it.
let sub = null;
let subCleanup = [];
try {
  sub = await fw.createSubaccount({
    country: 'NG',
    bankCode: '044',
    accountNumber: '0690000032',
    businessName: 'Test Estate Residents Association',
    businessEmail: 'dues-test@myestateaccess.com',
    feePercent: 0,
  });
  subCleanup.push(sub.id);
  ok('a subaccount can be created', Boolean(sub?.ref && sub?.id));
  ok('the charge reference is the RS_ form', /^RS_[A-F0-9]+$/i.test(sub.ref));
  ok('the management id is the numeric form', /^\d+$/.test(sub.id));
  // THE TRAP. These two ids are not interchangeable, and using the wrong one
  // reads exactly like the subaccount was deleted.
  ok('the two ids are different', sub.ref !== sub.id);
} catch (e) {
  ok(`a subaccount can be created — ${e.message}`, false);
}

// ─── Adopting, not duplicating ───────────────────────────────────────────────
//
// Flutterwave allows ONE subaccount per (account_number, bank) across the whole
// merchant account. A second create returns 400 "already exists". That is the
// NORMAL case for any account that has been used before -- a real estate hit it
// on its very first onboarding, with two subaccounts already present for the
// same bank account from an unrelated product.
//
// createSubaccount therefore adopts the existing one. The `created` flag is
// what keeps that safe: the caller rolls a failed save back by deleting the
// subaccount, and deleting one we merely adopted would destroy a payout
// destination belonging to somebody else, unrecoverably.
if (sub) {
  const again = await fw.createSubaccount({
    country: 'NG', bankCode: '044', accountNumber: '0690000032',
    businessName: 'Second Attempt', businessEmail: 'dues-test@myestateaccess.com',
    feePercent: 0,
  });
  ok('creating the same account twice adopts rather than duplicating', again.id === sub.id);
  ok('the first one is flagged as ours to clean up', sub.created === true);
  ok('...and the adopted one is NOT, so rollback will never delete it',
     again.created === false);

  // The property that actually protects the estate: no second subaccount was
  // made, so the merchant account did not quietly grow a duplicate.
  const list = await fw.getSubaccount(again.id);
  ok('the adopted subaccount is the same live record', list?.ref === sub.ref);
  // A fetch created nothing, so it must never claim otherwise.
  ok('a fetched subaccount never claims to be ours', list?.created === false);
}

if (sub) {
  const fetched = await fw.getSubaccount(sub.id);
  ok('a subaccount can be fetched back by its numeric id', fetched?.ref === sub.ref);

  // Pinning the asymmetry that the numeric id exists to work around: the RS_
  // reference -- the one a charge requires -- is NOT a valid key for GET. A
  // codebase that stored only that reference could never re-verify it.
  const byRef = await fw.getSubaccount(sub.ref);
  ok('...and NOT by its RS_ reference, which is why we store both', byRef === null);

  // Nigeria resolves an account name; the resolved holder is what we store and
  // show, so a transposed digit is visible before anyone is billed.
  ok('Nigeria confirms the account holder name',
     (await fw.resolveAccountName('0690000032', '044')) !== null);
  ok('a non-existent Nigerian account resolves to nothing',
     (await fw.resolveAccountName('0000000000', '044')) === null);
}

// ─── What a SANDBOX key can and cannot see ───────────────────────────────────
//
// DOCUMENTING A LIVE FINDING, and the reason the dashboard has a test-mode
// banner. On a test key Flutterwave's account lookup only knows its OWN
// sandbox accounts. A real Nigerian bank account comes back `400 invalid
// account` -- byte-for-byte the same answer as a genuine typo -- and creating
// a subaccount against one is refused outright.
//
// The consequence is the whole point: A REAL ESTATE CANNOT BE ONBOARDED ON
// TEST KEYS. Without saying so, an admin entering their true account number
// gets "that account is not valid" and goes looking for a transposed digit
// that does not exist.
ok('the client knows it is on a sandbox key', fw.isTestKey() === true);

// A real OPay account, reported from the dashboard on 27 Sep 2026.
ok('a REAL bank account does not resolve on a test key',
   (await fw.resolveAccountName('8122204698', '100004')) === null);

let realSubaccountRefused = false;
try {
  await fw.createSubaccount({
    country: 'NG', bankCode: '100004', accountNumber: '8122204698',
    businessName: 'Sandbox Reality Check', businessEmail: 'dues-test@myestateaccess.com',
    feePercent: 0,
  });
} catch {
  realSubaccountRefused = true;
}
ok('...and a subaccount cannot be created against it either', realSubaccountRefused);

// The control. If this ever fails, the sandbox stopped resolving its own test
// account and every assertion above is meaningless.
ok('a SANDBOX account still resolves, so the lookup itself works',
   (await fw.resolveAccountName('0690000032', '044')) !== null);

// South Africa has no name lookup at all -- a well-formed ZA account returns
// 400 "invalid account" exactly as a bad one does. That is why
// settlement_account_verified exists: "the bank confirmed this" and "an admin
// typed this" must not render identically on the dashboard.
ok('South Africa cannot verify an account name, and that is expected',
   (await fw.resolveAccountName('62152854587', 'FNB')) === null);

const ngBanks = await fw.listBanks('NG');
const zaBanks = await fw.listBanks('ZA');
ok('Nigerian banks list with numeric codes',
   ngBanks.length > 100 && ngBanks.some((b) => /^\d+$/.test(b.code)));
// Worth asserting because it is surprising: ZA codes are names, not numbers.
// A schema that assumed numeric bank codes would reject every ZA estate.
ok('South African banks list with alphabetic codes',
   zaBanks.length > 5 && zaBanks.some((b) => /^[A-Za-z]/.test(b.code)));

console.log('\n— live sandbox: checkout —');
const txRef = `dues-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let link = null;
try {
  link = await fw.createCheckout({
    txRef,
    amountMinor: 2500000,
    currency: 'NGN',
    redirectUrl: 'https://myestateaccess.com/dues/return',
    email: 'dues-test@myestateaccess.com',
    title: 'Estate dues',
    description: 'Monthly estate dues',
    subaccountRef: sub.ref,
    feePercent: 0.03,
  });
  ok('the API accepts our checkout payload', typeof link === 'string');
  // The sandbox serves checkout-v2.dev-flutterwave.com, not the
  // checkout.flutterwave.com their docs show. Assert the property that matters
  // -- HTTPS, on a Flutterwave domain -- rather than a hostname that differs
  // between environments.
  ok('it returns an https Flutterwave-hosted link',
     /^https:\/\/[a-z0-9.-]*flutterwave\.com\//.test(link));
} catch (e) {
  ok(`the API accepts our checkout payload — ${e.message}`, false);
}

// DOCUMENTING A LIVE FINDING, not asserting a wish.
//
// It is commonly assumed that Flutterwave rejects a duplicate tx_ref. It does
// not: posting the same reference twice returns 200 success both times with two
// different, separately payable checkout links. This test pins that behaviour
// so that if they ever change it, we find out here rather than in production.
//
// The consequence is the important part -- nothing on their side stops a reused
// reference becoming two real payments, so our own uniqueness is the only
// protection, and a reference must never be reused to retry.
let duplicateAccepted = false;
try {
  const second = await fw.createCheckout({
    txRef,
    amountMinor: 2500000,
    currency: 'NGN',
    redirectUrl: 'https://myestateaccess.com/dues/return',
    email: 'dues-test@myestateaccess.com',
    title: 'Estate dues',
    description: 'Monthly estate dues',
    subaccountRef: sub.ref,
    feePercent: 0.03,
  });
  duplicateAccepted = second !== link;
} catch {
  duplicateAccepted = false;
}
ok('Flutterwave still does NOT enforce tx_ref uniqueness (we must)', duplicateAccepted);

// Which is only safe because we never reuse one. Two starts, two references.
const refs = new Set(
  Array.from({ length: 500 }, () => `dues-${crypto.randomUUID().replaceAll('-', '')}`),
);
ok('our own references do not collide', refs.size === 500);
ok('and match the format v4 will require', [...refs].every((r) => /^[a-zA-Z0-9-]{6,42}$/.test(r)));

// ─── Live: verification ──────────────────────────────────────────────────────

// An unpaid reference. Whatever comes back must not look like a payment --
// this is the case an abandoned checkout produces, and treating it as success
// would credit dues nobody paid.
const unpaid = await fw.verifyTransaction({ txRef });
ok('an unpaid reference does not verify as successful', unpaid === null || unpaid.status !== 'successful');

const bogus = await fw.verifyTransaction({ transactionId: '999999999' });
ok('an unknown transaction id returns nothing', bogus === null);

const bogusRef = await fw.verifyTransaction({ txRef: 'dues-definitely-not-a-real-reference' });
ok('an unknown reference returns nothing', bogusRef === null);

// ─── The refusal that protects the estate's money ────────────────────────────

console.log('\n— refusing to charge without a destination —');

// ⚠️ THE FINDING THIS WHOLE GUARD EXISTS FOR.
//
// Flutterwave accepts a charge naming a subaccount that does not exist. It
// returns 200 success and a payable link; the split silently does not happen
// and the entire payment settles into the platform balance. No error is raised
// anywhere, at any later point, ever -- not on the charge, not on the webhook,
// not in reconciliation.
//
// So the gateway will never tell us the destination was wrong. createCheckout
// has to refuse locally, and these tests are what keep that refusal in place.
const refuses = async (label, patch) => {
  try {
    await fw.createCheckout({
      txRef: `dues-guard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      amountMinor: 100000,
      currency: 'NGN',
      redirectUrl: 'https://myestateaccess.com/dues/return',
      email: 'dues-test@myestateaccess.com',
      title: 'Estate dues',
      description: 'Monthly estate dues',
      subaccountRef: sub?.ref ?? 'RS_PLACEHOLDER',
      feePercent: 0,
      ...patch,
    });
    ok(label, false);
  } catch {
    ok(label, true);
  }
};

await refuses('a charge with no subaccount is refused before it leaves us', { subaccountRef: undefined });
await refuses('an empty subaccount is refused', { subaccountRef: '' });
await refuses('a malformed subaccount reference is refused', { subaccountRef: 'not-an-rs-id' });
await refuses('a commission above the ceiling is refused', { feePercent: 0.5 });
await refuses('a negative commission is refused', { feePercent: -0.01 });

// And the reason a local guard is the only possible defence: proof, live, that
// the gateway itself waves an invalid destination straight through.
let gatewayAcceptedBogus = false;
try {
  const res = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_ref: `dues-bogus-${Date.now()}`,
      amount: '100.00',
      currency: 'NGN',
      redirect_url: 'https://myestateaccess.com/dues/return',
      customer: { email: 'dues-test@myestateaccess.com' },
      customizations: { title: 'Estate dues' },
      subaccounts: [{ id: 'RS_TOTALLYNOTREAL', transaction_charge_type: 'percentage', transaction_charge: 0.05 }],
    }),
  });
  const body = await res.json();
  gatewayAcceptedBogus = res.ok && body?.status === 'success' && Boolean(body?.data?.link);
} catch {
  gatewayAcceptedBogus = false;
}
ok('Flutterwave still accepts a bogus subaccount silently (so we must not)',
   gatewayAcceptedBogus);

// ─── Cleanup ─────────────────────────────────────────────────────────────────
//
// Leave the account as we found it. An orphaned subaccount pointing at a real
// bank account is a payout destination with no record of why it exists.
for (const id of subCleanup) {
  const gone = await fw.deleteSubaccount(id);
  ok(`the test subaccount ${id} was removed`, gone);
  ok('...and no longer resolves', (await fw.getSubaccount(id)) === null);
}

// ─── Report ──────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (link) console.log(`\nCheckout link for a manual end-to-end run:\n  ${link}\n  tx_ref: ${txRef}`);
process.exit(fail === 0 ? 0 : 1);
