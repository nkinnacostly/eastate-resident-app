#!/usr/bin/env node
/**
 * Exercises the shared mail client (supabase/functions/_shared/mailer.ts)
 * against MyDomainsHub Mail.
 *
 *   CONTRACT — the request body is checked against the provider's OWN OpenAPI
 *              document, fetched live, not a hand-written list. Their schema
 *              is additionalProperties: false, so one stray field is a 422 on
 *              every email; this is where that would show up first.
 *   PURE     — answer classification with a stubbed fetch. Which answers
 *              retry, which give up, and the 409 that means "already sent".
 *              This decides whether the queue loses mail or blocks on it.
 *   LIVE     — real sends through the real client: one accepted email, the
 *              same request again under the same Idempotency-Key (must come
 *              back with the same id and send nothing more — the queue's
 *              exactly-once rests on it), and a malformed recipient that must
 *              be classed permanent.
 *
 * The live part sends ONE real email, to MAIL_TEST_TO (the shell, then
 * .env.local, falling back to the support mailbox, which is ours). While the account is in the
 * provider's sandbox that address must be a confirmed member of the team.
 *
 * Run with node 24: node 26's fetch fails TLS against some hosts here.
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

if (!env.DOMAINHUB_API_KEY) {
  console.error('DOMAINHUB_API_KEY is not in .env.local.');
  process.exit(2);
}

// The shared client is Deno source. Shim the one global it touches rather than
// weakening the production module for the benefit of a test.
globalThis.Deno = { env: { get: (k) => env[k] } };

const mailer = await import('../supabase/functions/_shared/mailer.ts');
const { resetPasswordCode } = await import('../supabase/functions/_shared/email-templates.ts');

let pass = 0;
let fail = 0;
const ok = (label, cond, extra) => {
  if (cond) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}${extra ? `\n      ${extra}` : ''}`);
  }
};

const realFetch = globalThis.fetch;
const email = { subject: 'Test', html: '<p>Test</p>', text: 'Test' };

/** Swap fetch for one canned answer and record what was asked. */
function stub(status, body, headers = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers });
  };
  return calls;
}

// ─── Contract: our body against their schema ────────────────────────────────

console.log('\n— request shape, against their OpenAPI —');

const spec = await (await realFetch('https://emails.mydomainshub.com/api/v1/openapi.json')).json();
const sendOp = spec.paths['/emails']?.post;
const schemaRef = sendOp?.requestBody?.content?.['application/json']?.schema?.$ref ?? '';
const schema = spec.components.schemas[schemaRef.split('/').pop()];
ok('their spec still describes POST /emails', Boolean(sendOp && schema));

{
  const calls = stub(200, { id: '6f1d3a52-2a0e-4f0b-9d55-0c1f2a3b4c5d' });
  await mailer.sendEmail('ada@example.com', email);
  const { url, init } = calls[0];
  const body = JSON.parse(init.body);
  const allowed = new Set(Object.keys(schema.properties));

  ok('posts to the documented endpoint', url === `${spec.servers?.[0]?.url ?? 'https://emails.mydomainshub.com/api/v1'}/emails`
    || url === 'https://emails.mydomainshub.com/api/v1/emails', url);
  ok('uses POST', init.method === 'POST');
  ok('authenticates with DOMAINHUB_API_KEY as a bearer token',
    init.headers.Authorization === `Bearer ${env.DOMAINHUB_API_KEY}`);
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  ok('sends no field their schema refuses', extra.length === 0, `extra: ${extra.join(', ')}`);
  const missing = schema.required.filter((k) => !(k in body));
  ok('sends every field their schema requires', missing.length === 0, `missing: ${missing.join(', ')}`);
  ok('sends from no-reply@, under the product name',
    body.from === 'myestateaccess <no-reply@myestateaccess.com>', body.from);
  ok('replies go to the support mailbox', body.reply_to === 'hello@myestateaccess.com', body.reply_to);
  ok('the support mailbox is never the sender', !body.from.includes('hello@'), body.from);
  ok('sends both html and text parts', body.html === email.html && body.text === email.text);
  ok('no Idempotency-Key unless one is asked for', !('Idempotency-Key' in init.headers));
}

// ─── Pure: idempotency keys ─────────────────────────────────────────────────

console.log('\n— idempotency keys —');

{
  let calls = stub(200, { id: 'x' });
  await mailer.sendEmail('a@example.com', email, { idempotencyKey: 'landlord-1234' });
  ok('a valid key goes through unchanged', calls[0].init.headers['Idempotency-Key'] === 'landlord-1234');

  // Dues keys carry the recipient's address, which can break their rule:
  // 1–256 printable ASCII, no spaces.
  const long = `dues-${'c'.repeat(36)}-due_soon-${'x'.repeat(240)}@example.com`;
  calls = stub(200, { id: 'x' });
  await mailer.sendEmail('a@example.com', email, { idempotencyKey: long });
  const sent = calls[0].init.headers['Idempotency-Key'];
  ok('an over-long key is hashed into their limit', /^sha256-[0-9a-f]{64}$/.test(sent), sent);

  calls = stub(200, { id: 'x' });
  await mailer.sendEmail('a@example.com', email, { idempotencyKey: long });
  ok('the hash is stable, so a retry still dedupes', calls[0].init.headers['Idempotency-Key'] === sent);

  calls = stub(200, { id: 'x' });
  await mailer.sendEmail('a@example.com', email, { idempotencyKey: 'dues-1-due_soon-adé@example.com' });
  ok('a non-ASCII key is hashed', /^sha256-/.test(calls[0].init.headers['Idempotency-Key']));

  calls = stub(200, { id: 'x' });
  await mailer.sendEmail('a@example.com', email, { idempotencyKey: 'has a space' });
  ok('a key with a space is hashed', /^sha256-/.test(calls[0].init.headers['Idempotency-Key']));
}

// ─── Pure: what each answer means ───────────────────────────────────────────

console.log('\n— answer classification —');

const err = (name) => ({ name, message: 'Something about the request.' });
const cases = [
  // [label, status, body, opts, expected sent, expected retryable]
  ['200 is sent, with their id', 200, { id: 'abc' }, {}, true, false],
  ['409 under a key means an earlier request was accepted: sent', 409, err('validation_error'), { idempotencyKey: 'k' }, true, false],
  ['409 with no key is not mistaken for sent', 409, err('validation_error'), {}, false, false],
  ['422 validation_error is permanent', 422, err('validation_error'), {}, false, false],
  ['413 too large is permanent', 413, err('validation_error'), {}, false, false],
  ['401 unauthorized waits for a key fix', 401, err('unauthorized'), {}, false, true],
  ['403 domain_not_verified waits for DNS', 403, err('domain_not_verified'), {}, false, true],
  ['403 account_paused waits for a human', 403, err('account_paused'), {}, false, true],
  ['403 forbidden (sandbox, new account) waits', 403, err('forbidden'), {}, false, true],
  ['429 rate_limited retries', 429, err('rate_limited'), {}, false, true],
  ['429 quota_exceeded retries', 429, err('quota_exceeded'), {}, false, true],
  ['500 internal_error retries', 500, err('internal_error'), {}, false, true],
  ['a non-JSON 502 from a proxy still retries', 502, '<html>Bad gateway</html>', {}, false, true],
];

for (const [label, status, body, opts, sent, retryable] of cases) {
  stub(status, body, { 'x-request-id': 'req-123' });
  const r = await mailer.sendEmail('a@example.com', email, opts);
  ok(label, r.sent === sent && (sent || r.retryable === retryable), JSON.stringify(r));
}

{
  stub(200, { id: 'abc' });
  const r = await mailer.sendEmail('a@example.com', email);
  ok('the provider id comes back on success', r.id === 'abc');

  stub(422, err('validation_error'), { 'x-request-id': 'req-123' });
  const f = await mailer.sendEmail('a@example.com', email);
  ok('a failure names the error and the request id for support',
    f.detail.includes('validation_error') && f.detail.includes('req-123'), f.detail);
}

{
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  let threw = false;
  try { await mailer.sendEmail('a@example.com', email); } catch { threw = true; }
  ok('a network failure throws (nobody knows if it arrived)', threw);
}

globalThis.fetch = realFetch;

// ─── Live ───────────────────────────────────────────────────────────────────

console.log('\n— live, against emails.mydomainshub.com —');

const to = process.env.MAIL_TEST_TO || env.MAIL_TEST_TO || mailer.REPLY_TO;
// The real reset template, so the live send proves our actual HTML and text
// get past their content check, not a toy body.
const live = resetPasswordCode({ otp: '000000' });
live.subject = `[test] ${live.subject}`;
const key = `mailer-test-${Date.now()}`;

const first = await mailer.sendEmail(to, live, { idempotencyKey: key });
ok('a real email is accepted', first.sent && first.status === 200 && Boolean(first.id), first.detail);

if (first.sent) {
  const again = await mailer.sendEmail(to, live, { idempotencyKey: key });
  ok('the same request under the same key is answered with the same id',
    again.sent && again.id === first.id, JSON.stringify(again));

  const changed = await mailer.sendEmail(to, { ...live, subject: `${live.subject} (changed)` }, { idempotencyKey: key });
  ok('a changed body under a used key reads as already sent, not as a failure',
    changed.sent && changed.status === 409, JSON.stringify(changed));
}

const bad = await mailer.sendEmail('not-an-address', live);
ok('a malformed recipient is refused and classed permanent',
  !bad.sent && !bad.retryable && bad.status === 422, JSON.stringify(bad));

console.log(`\n${pass} passed, ${fail} failed`);
if (first.sent) console.log(`Live email ${first.id} queued to ${to.replace(/^(.).*@/, '$1…@')}.`);
process.exit(fail ? 1 : 0);
