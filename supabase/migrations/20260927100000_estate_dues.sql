-- Estate Access Platform — estate dues
--
-- Residents pay a monthly due to the estate, and a resident in arrears cannot
-- generate visitor codes. Two estates bill differently and both must work:
--
--   per_house    — one charge per house. The landlord usually settles it, but
--                  anyone may. Every resident of a paid house can mint.
--   per_resident — one charge per resident. Common in blocks of flats where
--                  each occupant pays their own service charge.
--
-- ─── The charge is levied on a SUBJECT, and the payer is whoever pays ────────
--
-- This is the design decision the whole file turns on, and it comes straight
-- out of how the schema already models a landlord: `houses` carries
-- landlord_name / landlord_phone / landlord_email as DATA, with a comment
-- saying they never sign in. So "the landlord pays" cannot mean "the landlord
-- logs in and pays" — there is no account to log into.
--
-- Separating the two therefore is not a nicety, it is forced:
--
--   the SUBJECT of a charge  — a house, or a membership — is who owes it, and
--                              is what the gate checks.
--   the PAYER                — whoever actually settles it, who may have no
--                              account at all.
--
-- A house charge carries an unguessable token, so it can be paid from an
-- emailed link with no sign-in. That one mechanism covers the landlord, a
-- tenant paying on the landlord's behalf, and a managing agent paying in bulk,
-- without any of them needing a user row.
--
-- ─── Charges are materialised, not computed ──────────────────────────────────
--
-- A row per subject per month, created by a scheduled run. The tempting
-- alternative — derive what is owed on the fly from the estate's current rate —
-- is wrong for a ledger: it rewrites history every time the rate changes, so
-- last March's arrears silently become this year's amount. A charge records
-- what was owed at the time it was raised.

-- ─── Estate configuration ────────────────────────────────────────────────────

create type public.dues_billing_mode as enum ('none', 'per_house', 'per_resident');

alter table public.estates
  add column dues_billing_mode public.dues_billing_mode not null default 'none';

-- Minor units (kobo, cents) as an integer. Never a float: 0.1 + 0.2 is not 0.3
-- in binary floating point, and money that does not add up is money an estate
-- will not trust. Converted to major units only at the Flutterwave boundary,
-- which expects decimals.
alter table public.estates add column dues_amount_minor bigint;
alter table public.estates add column dues_currency text;

-- Days after the period starts before an unpaid charge blocks anything.
--
-- Seven by default. A resident should not be locked out of their own gate at
-- one minute past midnight on the 1st because a debit order clears on the 3rd,
-- and every dues regime in practice allows a settling window.
alter table public.estates add column dues_grace_days integer not null default 7;

alter table public.estates
  add constraint estates_dues_config_ck check (
    -- Configured coherently or not at all: a billing mode with no amount would
    -- raise charges of zero and lock an estate out of its own gate.
    (dues_billing_mode = 'none')
    or (dues_amount_minor is not null and dues_amount_minor > 0
        and dues_currency in ('NGN', 'ZAR'))
  );

alter table public.estates
  add constraint estates_dues_grace_ck check (dues_grace_days between 0 and 28);

comment on column public.estates.dues_billing_mode is
  'Who is billed. Drives both charge generation and the gate on code minting.';

-- ─── Charges ─────────────────────────────────────────────────────────────────

create type public.dues_charge_status as enum ('open', 'paid', 'waived');

create table public.dues_charges (
  id         uuid primary key default gen_random_uuid(),
  estate_id  uuid not null references public.estates (id) on delete cascade,

  -- First day of the month being billed. A date, not a range: dues are monthly
  -- by definition here, and a range would invite prorated half-months that the
  -- gate has no sensible answer for.
  period     date not null,

  -- Exactly one is set. Enforced below, because a charge that is against both
  -- a house and a resident is owed twice and a charge against neither is owed
  -- by nobody.
  house_id      uuid references public.houses (id)      on delete cascade,
  membership_id uuid references public.memberships (id) on delete cascade,

  -- Copied from the estate when raised, never read back through it. This is
  -- what makes the ledger a ledger: raising the rate in June must not restate
  -- what was owed in March.
  amount_minor bigint not null check (amount_minor > 0),
  currency     text   not null check (currency in ('NGN', 'ZAR')),

  -- period + grace. Stored rather than derived so that changing the estate's
  -- grace period does not retroactively make people delinquent.
  due_on     date not null,

  status     public.dues_charge_status not null default 'open',
  paid_at    timestamptz,

  -- A waiver is an ACT, with an actor and a reason -- the same shape as code
  -- revocation. An admin writing off a hardship case must be distinguishable
  -- from a charge that was simply paid.
  waived_at    timestamptz,
  waived_by_membership_id uuid references public.memberships (id),
  waive_reason text,

  -- Bearer token for the pay-by-link path. Its own column rather than reusing
  -- the id, so the identifier that appears in logs and foreign keys is not also
  -- the thing that authorises payment.
  pay_token  text not null default encode(extensions.gen_random_bytes(18), 'base64'),

  created_at timestamptz not null default now(),

  constraint dues_charges_one_subject_ck
    check ((house_id is null) <> (membership_id is null)),
  constraint dues_charges_paid_has_time_ck
    check ((status = 'paid') = (paid_at is not null)),
  constraint dues_charges_waived_has_reason_ck
    check ((status = 'waived') = (waived_at is not null))
);

-- One charge per subject per month. THE constraint that makes the monthly run
-- safe to re-run: a second pass inserts nothing rather than double-billing.
create unique index dues_charges_house_period_key
  on public.dues_charges (estate_id, house_id, period) where house_id is not null;
create unique index dues_charges_member_period_key
  on public.dues_charges (estate_id, membership_id, period) where membership_id is not null;

create unique index dues_charges_pay_token_key on public.dues_charges (pay_token);

-- The gate's query: open charges past their due date, for one subject.
create index dues_charges_overdue_idx
  on public.dues_charges (estate_id, due_on) where status = 'open';

-- ─── Payments ────────────────────────────────────────────────────────────────

create type public.dues_payment_status as enum
  ('initiated', 'successful', 'failed', 'abandoned');

create table public.dues_payments (
  id        uuid primary key default gen_random_uuid(),
  charge_id uuid not null references public.dues_charges (id) on delete cascade,

  -- OUR reference, generated before the customer leaves for the checkout page.
  --
  -- This is the idempotency key, and it has to be, because Flutterwave v3 has
  -- no idempotency header at all. It is the same role client_event_id plays for
  -- offline verification: claim it first, act once. Flutterwave enforces its
  -- uniqueness on their side too, so a duplicate initiate is rejected rather
  -- than charging twice.
  tx_ref    text not null unique,

  provider  text not null default 'flutterwave',
  -- Flutterwave's own transaction id (data.id). Null until they tell us.
  provider_tx_id text,

  -- What we asked for, frozen at initiation. The verify step compares against
  -- THIS, never against the estate's current rate -- otherwise an admin editing
  -- the amount mid-checkout changes what counts as full payment.
  amount_minor bigint not null check (amount_minor > 0),
  currency     text   not null,

  status    public.dues_payment_status not null default 'initiated',

  -- Null when paid from a link by someone with no account, which is the whole
  -- point of the link. Not a data-quality problem.
  initiated_by_membership_id uuid references public.memberships (id),
  payer_email text,

  -- The provider's own words, kept verbatim. When a payment is disputed months
  -- later this is the only record of what they actually told us.
  raw_payload jsonb,

  created_at timestamptz not null default now(),
  -- OUR clock, and what everything orders by. Flutterwave's created_at is their
  -- clock and the webhook can arrive out of order relative to the redirect --
  -- the same reason verification_events orders by synced_at and not verified_at.
  settled_at timestamptz
);

-- A provider transaction may be recorded once. With tx_ref above, this is the
-- pair that makes webhook-and-redirect arriving together safe: whichever lands
-- first wins, the second conflicts and does nothing.
create unique index dues_payments_provider_tx_key
  on public.dues_payments (provider, provider_tx_id) where provider_tx_id is not null;

create index dues_payments_charge_idx on public.dues_payments (charge_id, created_at desc);
-- Drives the reconciliation sweep for payments a webhook never arrived for.
create index dues_payments_pending_idx
  on public.dues_payments (created_at) where status = 'initiated';

comment on table public.dues_payments is
  'One row per payment attempt. tx_ref is the idempotency key -- Flutterwave v3 '
  'has no idempotency header, so the reference is the only thing standing '
  'between a retried webhook and a double credit.';
