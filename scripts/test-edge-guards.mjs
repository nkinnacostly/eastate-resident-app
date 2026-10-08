#!/usr/bin/env node
/**
 * The cron-only gate on send-emails, dispatch-notifications and dues-reconcile
 * (supabase/functions/_shared/caller.ts).
 *
 * The gateway's verify_jwt accepts the public anon key, so these functions
 * check the role claim themselves. This proves the claim check; the live half
 * (the gateway refusing a forged token, and the anon key getting 403) is in
 * the post-deploy checks, because only the deployed gateway can answer it.
 *
 *     npm run test:edge-guards
 */

const { isServiceRole } = await import('../supabase/functions/_shared/caller.ts');

let pass = 0;
let fail = 0;
const ok = (label, cond) => {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}`); }
};

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.c2lnbmF0dXJl`;
const req = (auth) => new Request('https://x/functions/v1/send-emails', {
  method: 'POST',
  headers: auth === undefined ? {} : { Authorization: auth },
});

ok('the service-role token cron sends is accepted', isServiceRole(req(`Bearer ${jwt({ role: 'service_role', iss: 'supabase' })}`)));
ok('the public anon key is refused', !isServiceRole(req(`Bearer ${jwt({ role: 'anon', iss: 'supabase' })}`)));
ok('a signed-in user\'s token is refused', !isServiceRole(req(`Bearer ${jwt({ role: 'authenticated', sub: 'u' })}`)));
ok('no Authorization header is refused', !isServiceRole(req(undefined)));
ok('a non-JWT bearer value is refused', !isServiceRole(req('Bearer sb_secret_notajwt')));
ok('a payload that is not JSON is refused', !isServiceRole(req('Bearer aaa.%%%%.bbb')));
ok('a role claim nested elsewhere is not mistaken for the role',
  !isServiceRole(req(`Bearer ${jwt({ role: 'anon', app_metadata: { role: 'service_role' } })}`)));
// base64url payloads use - and _ and drop padding; a decoder that only
// handled plain base64 would refuse real tokens at random.
const awkward = jwt({ role: 'service_role', pad: '??>>~~' });
ok('a base64url payload with - and _ still decodes', /[-_]/.test(awkward.split('.')[1]) && isServiceRole(req(`Bearer ${awkward}`)));
ok('the scheme is case-insensitive', isServiceRole(req(`bearer ${jwt({ role: 'service_role' })}`)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
