#!/usr/bin/env node
/**
 * Who receives which code when an account changes its email address.
 *
 * This is an account-hijack boundary, not copy. The hook used to send the NEW
 * address's link to the CURRENT inbox, so whoever held a session could confirm
 * both sides and move the account onto an address they do not own — and
 * landlord access is keyed on the account's confirmed address. The rule tested
 * here: no inbox ever receives a code or link that belongs to the other one.
 *
 *     npm run test:email-change
 */

const { emailChangeMails } = await import('../supabase/functions/_shared/email-change.ts');
const { emailChange } = await import('../supabase/functions/_shared/email-templates.ts');

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`); }
};

const user = { email: 'owner@example.com', new_email: 'target@example.com' };
// Distinct values, so a mail carrying the wrong one is unmistakable.
const secure = {
  token: '111111', token_hash: 'hash-for-NEW',
  token_new: '222222', token_hash_new: 'hash-for-CURRENT',
};

console.log('\n— secure email change: both addresses must confirm —');
{
  const mails = emailChangeMails(user, secure);
  const cur = mails.find((m) => m.to === user.email);
  const neu = mails.find((m) => m.to === user.new_email);
  ok('two mails, one per address', mails.length === 2 && cur && neu, JSON.stringify(mails));
  ok('current address gets token + token_hash_new', cur?.otp === '111111' && cur?.tokenHash === 'hash-for-CURRENT');
  ok('new address gets token_new + token_hash', neu?.otp === '222222' && neu?.tokenHash === 'hash-for-NEW');
  ok('the current inbox never sees the new address\'s code or link',
    !mails.some((m) => m.to === user.email && (m.otp === '222222' || m.tokenHash === 'hash-for-NEW')));
  ok('each mail is labelled for its own side', cur?.side === 'current' && neu?.side === 'new');
}

console.log('\n— secure email change off: one mail, to the new address —');
{
  const mails = emailChangeMails(user, { token: '333333', token_hash: 'only-hash' });
  ok('exactly one mail', mails.length === 1);
  ok('it goes to the NEW address, not the current one', mails[0]?.to === user.new_email, JSON.stringify(mails));
  ok('with the single pair', mails[0]?.otp === '333333' && mails[0]?.tokenHash === 'only-hash');
}

console.log('\n— malformed payload —');
{
  let threw = false;
  try { emailChangeMails({ email: 'a@example.com' }, secure); } catch { threw = true; }
  ok('no new_email is refused rather than mailed to the current address', threw);
}

console.log('\n— the mails themselves —');
{
  const cur = emailChange({ side: 'current', newEmail: 'target@example.com', confirmUrl: 'https://x/verify', otp: '111111' });
  ok('the current-address mail names the address it would move to', cur.text.includes('target@example.com') && cur.html.includes('target@example.com'));
  ok('and tells the owner what to do if it was not them', /change your password/i.test(cur.text));

  const hostile = emailChange({ side: 'current', newEmail: '"><img src=x onerror=alert(1)>@evil.test', confirmUrl: 'https://x', otp: '1' });
  ok('a hostile new address is escaped in the HTML', !hostile.html.includes('<img src=x'));

  const neu = emailChange({ side: 'new', newEmail: 'target@example.com', confirmUrl: 'https://x/verify', otp: '222222' });
  ok('the new-address mail carries its code', neu.html.includes('222222') && neu.text.includes('222222'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
