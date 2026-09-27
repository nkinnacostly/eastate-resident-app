// Flutterwave v3 client.
//
// ─── Why v3 and not v4 ───────────────────────────────────────────────────────
//
// v4 exists and is newer, and is the wrong choice here today (checked against
// developer.flutterwave.com, 27 Sep 2026):
//
//   * v4 has NO documented hosted checkout. Its only published charge path
//     takes encrypted card fields you collect yourself, which puts this
//     codebase in PCI scope. There IS a `POST /checkout/sessions` in the
//     OpenAPI the docs site serves, but the page for it is `"hidden": true`,
//     `"robots": "noindex"`, with an empty body and no examples -- unannounced
//     and unsupported.
//   * v4 has no payment plans, no subscriptions, no tokenisation.
//   * The docs platform still flags 4.0.0 as `is_beta: true`, 3.0.0 as
//     `is_stable: true`.
//   * Flutterwave Engineering, on the v4 beta: "v3 isn't going anywhere.
//     There are currently no plans to deprecate v3."
//
// Worth re-checking on any significant change: there is no published v3 sunset
// date, and their `/docs/versioning` page 404s, so there is no deprecation
// policy to rely on either.

const BASE = 'https://api.flutterwave.com/v3';

const SECRET_KEY = Deno.env.get('FLUTTERWAVE_SECRET_KEY');

/** Minor units (kobo/cents) to the decimal major units the v3 API expects. */
export const toMajor = (minor: number): number => Number((minor / 100).toFixed(2));

/**
 * Major units back to integer minor units.
 *
 * Via a rounded string, not `major * 100`. In binary floating point
 * `25000.07 * 100` is 2500006.9999999995, and `Math.round` of that is right
 * only by luck at this magnitude. Money comparisons must not depend on luck.
 */
export const toMinor = (major: number | string): number =>
  Math.round(Number(major) * 100);

function authHeaders() {
  if (!SECRET_KEY) throw new Error('FLUTTERWAVE_SECRET_KEY is not configured');
  // No colon after Bearer. Their own authentication page's prose shows
  // "Bearer: YOUR_SECRET_KEY"; every code sample omits the colon, and the
  // samples are right.
  return { Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json' };
}

export interface CheckoutRequest {
  txRef: string;
  amountMinor: number;
  currency: string;
  redirectUrl: string;
  email: string;
  name?: string;
  title: string;
  description: string;
  /**
   * The estate's Flutterwave subaccount (RS_...). REQUIRED.
   *
   * Not optional, and the type says so on purpose. Estate dues must settle
   * into the estate's own bank account, never ours -- see the long note in
   * migration 20260927190000. An optional field here is one `?? undefined`
   * away from a charge that quietly pays the platform instead, and because
   * Flutterwave accepts a missing or invalid subaccount without complaint,
   * nothing downstream would ever report it.
   */
  subaccountRef: string;
  /** Our commission as a decimal fraction. 0.05 is five percent; 0 is none. */
  feePercent: number;
}

/**
 * Create a hosted checkout and return the link to send the payer to.
 *
 * The amount is set HERE, server-side, from a charge row. It is never accepted
 * from a client -- which is the structural version of the defence, and the
 * reason the later amount re-check is belt-and-braces rather than the only
 * thing standing between us and a chosen price.
 *
 * ⚠️ FLUTTERWAVE DOES NOT ENFORCE tx_ref UNIQUENESS. Verified against their
 * sandbox on 27 Sep 2026: posting the same tx_ref twice returns 200 success
 * both times, with two DIFFERENT checkout links. Both are payable. It is widely
 * assumed -- including in their own community answers -- that a duplicate
 * reference is rejected; it is not.
 *
 * So never reuse a reference to "retry" a checkout. Every attempt gets a fresh
 * one from start_dues_payment, and the unique index on dues_payments.tx_ref is
 * ours alone to rely on. If a reference were reused and both links paid, we
 * would credit once (settle is keyed on tx_ref) and have no record of the
 * second payment -- money taken with nothing to show for it.
 */
export async function createCheckout(r: CheckoutRequest): Promise<string> {
  // ⚠️ AN INVALID SUBACCOUNT IS ACCEPTED SILENTLY. Verified in their sandbox on
  // 27 Sep 2026: a charge naming subaccount "RS_TOTALLYNOTREAL" returns 200
  // success with a payable link. The split simply does not happen and the
  // entire payment settles to the platform -- with no error, anywhere, ever.
  //
  // So this check is not defensive tidiness. It is the last point at which a
  // missing destination can still be noticed, because the payment path will
  // never notice it for us.
  if (!r.subaccountRef || !r.subaccountRef.startsWith('RS_')) {
    throw new Error('refusing to charge without the estate subaccount');
  }
  if (!(r.feePercent >= 0 && r.feePercent <= 0.2)) {
    throw new Error(`refusing to charge with fee ${r.feePercent}`);
  }

  const res = await fetch(`${BASE}/payments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      tx_ref: r.txRef,
      amount: toMajor(r.amountMinor),
      currency: r.currency,
      redirect_url: r.redirectUrl,
      // `phone_number`, not `phonenumber`: the OpenAPI reference and the prose
      // guide disagree, and the machine-readable spec is the better source.
      // Omitted entirely here since we have no phone for a landlord paying by
      // link.
      customer: { email: r.email, name: r.name ?? undefined },
      customizations: { title: r.title, description: r.description },
      // Nested under `configuration`, per the OpenAPI spec. The prose guide
      // lists these as top-level and the spec wins.
      configuration: { session_duration: 60, max_retry_attempt: 3 },
      // ─── The split ───────────────────────────────────────────────────────
      //
      // This one array is the difference between a lawful design and an
      // unlawful one. The subaccount is the estate's own bank account, so the
      // dues settle there directly and never enter our balance.
      //
      // `percentage` charges OUR commission and gives the subaccount the rest:
      // "to collect a 9% commission, transaction_charge_type will be
      // 'percentage' and transaction_charge will be 0.09". A flat split is
      // avoided deliberately -- Nigeria's ₦50 stamp duty on qualifying
      // transfers can exceed the room in a flat split and void it, sending the
      // whole payment to the main account.
      subaccounts: [{
        id: r.subaccountRef,
        transaction_charge_type: 'percentage',
        transaction_charge: r.feePercent,
      }],
    }),
    // Their system waits 28 seconds before returning a timeout, so a client
    // timeout below that abandons requests that are still alive server-side.
    signal: AbortSignal.timeout(35_000),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== 'success' || !body?.data?.link) {
    throw new Error(`flutterwave checkout failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.data.link as string;
}

export interface VerifiedTransaction {
  providerTxId: string;
  txRef: string;
  status: string;
  amountMinor: number;
  currency: string;
  raw: Record<string, unknown>;
}

/**
 * Re-query a transaction. THIS IS THE SECURITY CONTROL, not a formality.
 *
 * v3's webhook `verif-hash` is a static shared secret echoed verbatim in a
 * header on every call -- not an HMAC over the payload. It therefore proves
 * nothing about what the payload SAYS: it is tamper-evident for nothing and
 * replayable by anyone who has ever seen one request. Flutterwave's own
 * instruction is unambiguous: "Before giving value to a customer based on a
 * webhook notification, always re-query our API to verify the transaction
 * details."
 *
 * So: nothing in this codebase credits a charge from a webhook body. Both the
 * webhook and the browser redirect call this first, and settlement only ever
 * happens on what comes back from here.
 */
export async function verifyTransaction(
  opts: { transactionId?: string; txRef?: string },
): Promise<VerifiedTransaction | null> {
  const url = opts.transactionId
    ? `${BASE}/transactions/${encodeURIComponent(opts.transactionId)}/verify`
    // The fallback that matters: on a failed or cancelled payment Flutterwave
    // only promises `tx_ref` and `status` on the redirect -- `transaction_id`
    // may not be there at all.
    : `${BASE}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(opts.txRef!)}`;

  const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(35_000) });
  const body = await res.json().catch(() => null);

  // "No transaction was found for this id" is a legitimate answer, not a
  // failure: it is what an abandoned checkout looks like.
  if (!res.ok || body?.status !== 'success' || !body?.data) return null;

  const d = body.data;
  return {
    providerTxId: String(d.id),
    txRef: String(d.tx_ref),
    status: String(d.status),
    // `charged_amount` is what the customer actually paid; `amount` is what was
    // requested and `amount_settled` is net of their fee. Credit on what was
    // paid, and fall back to `amount` only if they omit it.
    amountMinor: toMinor(d.charged_amount ?? d.amount),
    currency: String(d.currency),
    raw: redact(d),
  };
}

/**
 * Strip live credentials before the payload is stored.
 *
 * `card.token` can charge this customer again with no further consent. Keeping
 * it would make this table a credential store and drag it into PCI scope for
 * no benefit -- we do not do merchant-initiated charges. BIN and last4 are
 * truncated PAN and are fine to keep for support.
 */
function redact(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...d };
  const card = out.card as Record<string, unknown> | undefined;
  if (card) {
    const { token: _token, ...rest } = card;
    out.card = rest;
  }
  delete out.account;
  return out;
}

/**
 * Constant-time string compare for the webhook secret.
 *
 * `a === b` on a secret leaks its prefix through timing. The comparison is
 * cheap defence for a mechanism that is already weak -- see verifyTransaction
 * on why `verif-hash` is not a signature.
 */
export function secretMatches(header: string | null, expected: string | undefined): boolean {
  if (!header || !expected) return false;
  const a = new TextEncoder().encode(header);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ─── Subaccounts: where an estate's money actually lands ─────────────────────
//
// ⚠️ A SUBACCOUNT HAS TWO IDS AND THEY ARE NOT INTERCHANGEABLE.
//
//   `subaccount_id`  "RS_F317C04E..."  -> the charge payload wants this one
//   `id`             26704 (numeric)   -> GET and DELETE want this one
//
// GET /subaccounts/RS_F317C04E... returns 400 "Subaccount not found" for a
// subaccount that was created seconds earlier and demonstrably exists. Both
// are stored on the estate row; using the wrong one fails in a way that reads
// like the subaccount was deleted.

export interface Subaccount {
  /** Numeric id, as a string. The only id that GET and DELETE accept. */
  id: string;
  /** RS_... reference. The only id a charge accepts. */
  ref: string;
  /** For NG this is the bank's own record of the holder; for ZA, what we sent. */
  fullName: string;
  bankName: string | null;
}

async function fw(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(35_000),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok && json?.status === 'success', status: res.status, json };
}

/** Banks we can pay out to, for the dropdown. NG returns ~600, ZA ~21. */
export async function listBanks(country: 'NG' | 'ZA'): Promise<{ code: string; name: string }[]> {
  const r = await fw('GET', `/banks/${country}`);
  if (!r.ok) throw new Error(`could not list banks: ${r.status}`);
  return (r.json.data as { code: string; name: string }[])
    .map((b) => ({ code: b.code, name: b.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Ask the bank who owns an account number.
 *
 * ⚠️ NIGERIA ONLY, IN PRACTICE. NG returns the registered holder's name. ZA
 * returns 400 "invalid account" even for a perfectly valid account -- there is
 * no name lookup on that rail. Verified in their sandbox, 27 Sep 2026.
 *
 * `null` therefore means two different things by country, and the caller has to
 * keep them apart: in NG it means the account does not exist and we must
 * refuse; in ZA it means we cannot check, which is not the same as wrong. That
 * distinction is what estates.settlement_account_verified records, so a screen
 * can say "First National Bank confirmed this is the body corporate's account"
 * in one case and "we could not verify this -- please check it" in the other.
 */
export async function resolveAccountName(
  accountNumber: string,
  bankCode: string,
): Promise<string | null> {
  const r = await fw('POST', '/accounts/resolve', {
    account_number: accountNumber,
    account_bank: bankCode,
  });
  if (!r.ok) return null;
  const name = r.json?.data?.account_name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export async function createSubaccount(opts: {
  country: 'NG' | 'ZA';
  bankCode: string;
  accountNumber: string;
  businessName: string;
  businessEmail: string;
  feePercent: number;
}): Promise<Subaccount> {
  const r = await fw('POST', '/subaccounts', {
    account_bank: opts.bankCode,
    account_number: opts.accountNumber,
    business_name: opts.businessName,
    business_email: opts.businessEmail,
    country: opts.country,
    // The default split, used only if a charge omits its own override. Ours
    // never does -- the charge is explicit so that editing a subaccount in the
    // Flutterwave dashboard cannot silently change what an estate receives.
    split_type: 'percentage',
    split_value: opts.feePercent,
  });
  if (!r.ok) {
    throw new Error(`could not create subaccount: ${r.json?.message ?? r.status}`);
  }
  const d = r.json.data;
  return {
    id: String(d.id),
    ref: String(d.subaccount_id),
    fullName: String(d.full_name ?? opts.businessName),
    bankName: d.bank_name ? String(d.bank_name) : null,
  };
}

/** Fetch by NUMERIC id. Passing the RS_ reference here always 404s. */
export async function getSubaccount(numericId: string): Promise<Subaccount | null> {
  const r = await fw('GET', `/subaccounts/${encodeURIComponent(numericId)}`);
  if (!r.ok) return null;
  const d = r.json.data;
  return {
    id: String(d.id),
    ref: String(d.subaccount_id),
    fullName: String(d.full_name ?? ''),
    bankName: d.bank_name ? String(d.bank_name) : null,
  };
}

/** Delete by NUMERIC id. Used to roll back a half-built settlement record. */
export async function deleteSubaccount(numericId: string): Promise<boolean> {
  const r = await fw('DELETE', `/subaccounts/${encodeURIComponent(numericId)}`);
  return r.ok;
}
