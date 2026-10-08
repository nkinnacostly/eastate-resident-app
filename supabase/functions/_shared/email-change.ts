// Who gets which code when someone changes their email address.
//
// Kept apart from auth-emails so it can be tested without a signed hook
// payload: getting it wrong is an account hijack, not a typo. It used to send
// the new address's link to the CURRENT inbox, so whoever held the session
// could confirm both sides and move the account onto an address they do not
// own — and landlord access is keyed on that address.
//
// Supabase's field names are reversed for backward compatibility (Send Email
// Hook docs, checked 8 Oct 2026):
//
//   current address (user.email)     → token     + token_hash_new
//   new address     (user.new_email) → token_new + token_hash
//
// With secure email change off only one pair arrives, and it belongs to the
// new address.

export interface EmailChangeMail {
  to: string;
  side: 'current' | 'new';
  otp: string;
  tokenHash: string;
}

export function emailChangeMails(
  user: { email: string; new_email?: string },
  d: { token: string; token_hash: string; token_new?: string; token_hash_new?: string },
): EmailChangeMail[] {
  const newEmail = user.new_email;
  if (!newEmail) throw new Error('email_change without new_email');

  if (d.token_new && d.token_hash_new) {
    return [
      { to: user.email, side: 'current', otp: d.token, tokenHash: d.token_hash_new },
      { to: newEmail, side: 'new', otp: d.token_new, tokenHash: d.token_hash },
    ];
  }
  return [{ to: newEmail, side: 'new', otp: d.token || d.token_new || '', tokenHash: d.token_hash }];
}
