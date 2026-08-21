/**
 * Every input rule in the resident app, in one place.
 *
 * These are zod schemas rather than inline `if` checks so the rule, the message
 * a resident reads, and the enabled state of the submit button all come from a
 * single source. A screen never re-states a rule — it renders whatever the
 * resolver says.
 *
 * Nothing here is a security boundary. Minting, the 3-code cap and the rate
 * limit are enforced transactionally inside mint_access_code (Technical Design
 * §3.1), and join codes are resolved by request_house_access; a client schema
 * only stops a resident submitting input that cannot possibly be accepted. Do
 * not let a check migrate here FROM the server.
 */
import { MAX_DELIVERY_NOTE_LENGTH } from '@estate/core';
import { z } from 'zod';

// ─── Shared field rules ───────────────────────────────────────────────────────

/**
 * Trimmed before the format check: a phone keyboard adds a trailing space from
 * autocorrect constantly, and " rita@example.com " is not a typo worth refusing
 * — it is the right address with lint on it. Supabase treats the untrimmed
 * version as a different, non-existent user, so the trim is also the fix for a
 * sign-in that fails with no visible reason.
 */
const emailField = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .pipe(z.email('That does not look like an email address.'));

/**
 * bcrypt — and therefore Supabase Auth — ignores anything past 72 characters,
 * so a longer password can never be the one that was set. Verified against the
 * Supabase password-security docs, Aug 2026.
 */
const SUPABASE_PASSWORD_MAX = 72;

/**
 * Mirrors `minimum_password_length = 6` in supabase/config.toml. Read from
 * there rather than chosen here: a client minimum ABOVE the server's refuses a
 * password the server would have accepted, and one below it produces a rejection
 * the resident cannot see coming. Change both together, or neither.
 */
const SUPABASE_PASSWORD_MIN = 6;

/**
 * The two join codes are checked for PRESENCE ONLY — deliberately no format,
 * case or length rule.
 *
 * request_house_access normalises case and strips separators before it looks
 * anything up, so `demo-4821`, `DEMO4821` and `Demo 4821` are the same code to
 * the server. A client-side format rule would refuse codes the estate actually
 * issued, on the one screen where being wrongly refused leaves someone with no
 * way into the app at all. The server decides whether a code exists; this only
 * stops an empty submission.
 */
const joinCodeShape = {
  estateCode: z.string().trim().min(1, 'Enter the code your estate gave you.'),
  houseCode: z.string().trim().min(1, 'Enter the code your landlord gave you.'),
};

// ─── Sign in ──────────────────────────────────────────────────────────────────

export const signInSchema = z.object({
  email: emailField,

  /**
   * Presence only — deliberately no complexity rule, and no minimum length.
   *
   * This is a SIGN-IN form. The password already exists; enforcing today's
   * rules here would lock out a resident whose password predates them, on a
   * screen whose only recovery route is "ask your estate admin". Strength
   * belongs where passwords are SET — see signUpSchema.
   *
   * Not trimmed, for a different reason: a leading space may be part of the
   * password, and silently eating it turns a correct password into a failed
   * sign-in with no explanation.
   */
  password: z
    .string()
    .min(1, 'Enter your password.')
    .max(SUPABASE_PASSWORD_MAX, `A password is at most ${SUPABASE_PASSWORD_MAX} characters.`),
});

export type SignInValues = z.infer<typeof signInSchema>;

// ─── Sign up ──────────────────────────────────────────────────────────────────

/**
 * Required, not optional.
 *
 * The name is the only thing an estate admin has to go on when they approve a
 * join request — the queue shows a name and a house number and nothing else.
 * A blank one makes the request unapprovable, which strands the person who sent
 * it, so it is collected where it costs one field rather than a support call.
 */
const fullNameField = z
  .string()
  .trim()
  .min(2, 'Enter your full name — your estate admin approves you by it.')
  .max(80, 'That name is too long.');

/**
 * Optional, and validated only if something was typed.
 *
 * Kept permissive on purpose. Residents type +234 803 123 4567, 0803-123-4567
 * and (080) 3123 4567 for the same number, and a strict pattern would reject
 * real numbers for cosmetic reasons. The rules are the two that are actually
 * true everywhere: only dialling characters, and a digit count inside E.164's
 * 7–15 range.
 */
const phoneField = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || /^\+?[\d\s().-]+$/.test(value),
    'A phone number can only contain digits, spaces and + ( ) - .',
  )
  .refine((value) => {
    if (value === '') return true;
    const digits = value.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15;
  }, 'That does not look like a complete phone number.');

export const signUpSchema = z.object({
  fullName: fullNameField,
  email: emailField,
  phone: phoneField,

  /**
   * A minimum here but not on sign-in, because this is where the password is
   * chosen and the server will reject a short one anyway. Meeting the rule in
   * the field beats meeting it in an alert after the account attempt fails.
   */
  password: z
    .string()
    .min(SUPABASE_PASSWORD_MIN, `Use at least ${SUPABASE_PASSWORD_MIN} characters.`)
    .max(SUPABASE_PASSWORD_MAX, `A password is at most ${SUPABASE_PASSWORD_MAX} characters.`),

  /**
   * Both codes, up front. A house code alone cannot place anyone — it is only
   * unique within its estate — and an account created with no join request
   * attached becomes a stranded user no admin ever sees.
   */
  ...joinCodeShape,
});

export type SignUpValues = z.infer<typeof signUpSchema>;

// ─── Join ─────────────────────────────────────────────────────────────────────

export const joinSchema = z.object(joinCodeShape);

export type JoinValues = z.infer<typeof joinSchema>;

// ─── Delivery instructions ────────────────────────────────────────────────────

/**
 * The note is genuinely optional — an empty one is VALID, and the button that
 * submits it stays enabled. "Disabled until valid" and "always enabled" are the
 * same statement for a field whose only rule is a maximum.
 *
 * The maximum mirrors the CHECK constraint and mint_access_code's own limit
 * (MAX_DELIVERY_NOTE_LENGTH). The input also caps typing at that number, so
 * this is a backstop for a paste or a dictation that arrives over the limit —
 * without it the only feedback is a `note_too_long` result after the round trip.
 */
export const deliveryNoteSchema = z.object({
  note: z
    .string()
    .max(
      MAX_DELIVERY_NOTE_LENGTH,
      `Instructions are at most ${MAX_DELIVERY_NOTE_LENGTH} characters.`,
    ),
});

export type DeliveryNoteValues = z.infer<typeof deliveryNoteSchema>;
