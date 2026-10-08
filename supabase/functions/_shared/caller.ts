// Is this request from the service role — i.e. our own pg_cron job?
//
// verify_jwt = true is NOT that check. It only proves the request carries a
// token this project signed, and the public anon key compiled into every app
// is such a token. A cron-only function that stops at the gateway is callable
// by anyone holding the app.
//
// The gateway has already verified the signature (these functions keep
// verify_jwt on), so reading the role claim here is enough: a token whose
// claim says service_role but whose signature is not ours never gets this far.
// The cron jobs send the service-role JWT from Vault (`service_role_key`).

export function isServiceRole(req: Request): boolean {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')));
    return claims?.role === 'service_role';
  } catch {
    return false;
  }
}

export const forbidden = () =>
  new Response(JSON.stringify({ error: 'forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
