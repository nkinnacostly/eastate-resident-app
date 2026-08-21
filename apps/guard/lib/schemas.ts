/**
 * Every input rule in the guard app, in one place.
 *
 * These are zod schemas rather than inline `if` checks so that the rule, the
 * message a guard reads, and the enabled state of the submit button all come
 * from a single source. A screen never re-states a rule — it renders whatever
 * the resolver says.
 *
 * Nothing here is a security boundary. Verification and the code burn happen
 * server-side inside verify_access_code (Technical Design §4); a client schema
 * only stops a guard wasting a trip to the gate on input that cannot possibly
 * match. Do not let a check migrate here FROM the server.
 */
import { CODE_CHARSET, CODE_LENGTH } from '@estate/core';
import { z } from 'zod';

// ─── Sign in / start shift ────────────────────────────────────────────────────

/**
 * bcrypt — and therefore Supabase Auth — ignores anything past 72 characters,
 * so a longer password can never be the right one. Verified against the
 * Supabase password-security docs, Aug 2026.
 */
const SUPABASE_PASSWORD_MAX = 72;

export const signInSchema = z.object({
  /**
   * Trimmed before the format check: a phone keyboard adds a trailing space
   * from autocorrect constantly, and " g@estate.co.za " is not a typo worth
   * refusing — it is the right address with lint on it.
   */
  email: z
    .string()
    .trim()
    .min(1, 'Enter the email your estate signed you up with.')
    .pipe(z.email('That does not look like an email address.')),

  /**
   * Presence only — deliberately no complexity rule.
   *
   * This is a SIGN-IN form. The password already exists; whether it has a
   * digit or a symbol is not this screen's business, and enforcing today's
   * rules here would lock out a guard whose password predates them, on a
   * screen with no way to recover. Strength belongs where passwords are SET,
   * which is Supabase Auth, not here.
   *
   * Not trimmed, for the same reason: a leading space may be part of the
   * password, and silently eating it turns a correct password into a failed
   * sign-in with no explanation.
   */
  password: z
    .string()
    .min(1, 'Enter your password.')
    .max(SUPABASE_PASSWORD_MAX, `A password is at most ${SUPABASE_PASSWORD_MAX} characters.`),
});

export type SignInValues = z.infer<typeof signInSchema>;

// ─── Access code ──────────────────────────────────────────────────────────────

/**
 * The charset check is not belt-and-braces over the keypad.
 *
 * The keypad can only emit these glyphs today, but it is one component away
 * from a paste handler, a scanner, or a bluetooth keyboard — and the whole
 * reason 0/O and 1/I/L are excluded is that they get misread at a gate. Stating
 * the rule as data means a future input path inherits it, instead of quietly
 * sending `7K4P9O` to the server to come back `unknown_code`.
 *
 * Mirrors public.generate_code(); CODE_CHARSET is the shared constant.
 */
export const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .length(CODE_LENGTH, `A code is ${CODE_LENGTH} characters.`)
    .refine(
      (value) => value.split('').every((char) => CODE_CHARSET.includes(char)),
      'That code contains a character no code can contain.',
    ),
});

export type CodeValues = z.infer<typeof codeSchema>;
