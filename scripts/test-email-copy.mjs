#!/usr/bin/env node
/**
 * What the dues emails actually promise a resident.
 *
 * ─── Why this is a test and not a proofread ─────────────────────────────────
 *
 * Every dues email carried the line "a guard can still let a visitor in at the
 * gate." A resident read it and asked the obvious question: if my dues are
 * unpaid, how does my visitor get in without a code, and why?
 *
 * It was describing the guard's admit-and-flag OVERRIDE — a rare, logged
 * exception that raises a Flagged entry for the estate admin to review. Told
 * to a resident in arrears it is three kinds of wrong at once: it advertises a
 * bypass, it makes the dues gate look pointless, and it promises something
 * nobody should rely on.
 *
 * Copy that reassures by describing a loophole is a specific, repeatable
 * mistake, and proofreading does not catch it twice. So the promises these
 * emails make are asserted.
 *
 *     npm run test:email-copy
 */

import { readFileSync } from 'node:fs';

// The templates are Deno source with no Deno API use, so a bare import works.
const mod = await import('../supabase/functions/_shared/email-templates.ts');

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`); }
};

const base = {
  recipientName: 'Ada',
  estateName: 'Demo Estate',
  houseNumber: '12',
  amount: '₦2,500',
  dueOn: '8 October 2026',
  daysLeft: 7,
  appUrl: 'https://myestateaccess.com/app',
  // The consequence lines below are only true where the estate has switched
  // the pause on; see the codesPause:false pass further down.
  codesPause: true,
};

// Every shape the reminder takes. A promise that is wrong in one variant is
// wrong for whoever receives that variant.
const variants = {
  'landlord, house-billed': { ...base, role: 'landlord', landlordPays: true, payUrl: 'https://pay' },
  'tenant of a house-billed estate': { ...base, role: 'resident', landlordPays: true, payUrl: null },
  'resident billed directly': { ...base, role: 'resident', landlordPays: false, payUrl: null },
};

for (const [name, v] of Object.entries(variants)) {
  const { html, text, subject } = mod.duesReminder(v);
  const both = `${html}\n${text}`;
  const plain = both.replace(/\s+/g, ' ');

  // ★ THE ONE THAT PROMPTED THIS ★
  ok(`${name}: never claims a guard admits a visitor without a code`,
    !/guard can (still )?(let|admit)/i.test(plain)
    && !/let a visitor in at the gate/i.test(plain),
    'This describes the admit-and-flag override — a logged exception the estate '
    + 'reviews, not a promise to a resident in arrears.');

  // The two reassurances that ARE true, and are the reason the sentence
  // existed. Removing the false one must not take them with it.
  ok(`${name}: says their own access to the estate is unaffected`,
    /own access to the estate is (unaffected|never affected)/i.test(plain));

  ok(`${name}: says codes already shared keep working`,
    /already (shared|issued) keeps? working/i.test(plain));

  // The restriction is on MINTING, and saying so precisely is what stops the
  // reader assuming they are about to be locked out of their own home.
  ok(`${name}: says it is NEW codes that stop, not all of them`,
    /generate NEW visitor codes/i.test(both));

  ok(`${name}: names the amount and the date in the subject or body`,
    subject.includes('₦2,500') || plain.includes('₦2,500'));
}

// ─── Where the estate has NOT authorised pausing codes ───────────────────────
//
// Every reminder used to threaten paused codes regardless. Where the committee
// never adopted that rule, saying so is threatening a sanction that does not
// exist -- precisely what recording the authority for it is meant to prevent.
for (const [name, v] of Object.entries(variants)) {
  const { html, text, subject } = mod.duesReminder({ ...v, codesPause: false });
  const plain = `${html}\n${text}`.replace(/\s+/g, ' ');
  ok(`${name}, no pause rule: never mentions visitor codes being stopped`,
    !/NEW visitor codes|affect your visitor codes/i.test(plain));
  ok(`${name}, no pause rule: still names the amount`,
    subject.includes('₦2,500') || plain.includes('₦2,500'));
}

// A landlord gets a pay link; a tenant must never be sent one — it is a bearer
// token over somebody else's bill.
const landlord = mod.duesReminder(variants['landlord, house-billed']);
const tenant = mod.duesReminder(variants['tenant of a house-billed estate']);
ok('a landlord is given a way to pay', /https:\/\/pay/.test(landlord.html + landlord.text));
ok('a tenant is NOT sent the landlord’s pay link',
  !/https:\/\/pay/.test(tenant.html + tenant.text));

// And the source itself, because a new template could reintroduce the claim
// without going through duesReminder at all.
const src = readFileSync('supabase/functions/_shared/email-templates.ts', 'utf8');
ok('no template anywhere still describes the guard override to a resident',
  !/guard can (still )?(let|admit)/i.test(src));

// ─── Password recovery must lead somewhere real ──────────────────────────────
//
// The guard welcome email told guards to use "Forgot password" in the guard
// app, and the admin email pointed at the dashboard's -- neither screen
// existed, so a guard or admin whose link expired had no way back in. The
// dashboard has one now; the guard app still does not, so guards are sent
// there.
const guard = mod.guardWelcome({
  guardName: 'Gary', estateName: 'Demo Estate',
  setPasswordUrl: 'https://set.example/abc', dashboardUrl: 'https://app.myestateaccess.com',
});
ok('a guard whose link expired is sent to the dashboard reset, which exists',
  guard.html.includes('app.myestateaccess.com') && guard.text.includes('Forgot password" at https://app.myestateaccess.com'));
ok('...and never to a guard-app "Forgot password" screen, which does not',
  !/forgot password.{0,40}guard app|guard app.{0,40}forgot password/i.test(guard.html + guard.text));

const reset = mod.resetPasswordCode({ otp: '123456' });
ok('the reset-code email works for the dashboard as well as the app',
  !/in the app/i.test(reset.html + reset.text) && (reset.html + reset.text).includes('123456'));

// The invitation to an EXISTING account. It must not read like the welcome:
// nothing has happened yet, and ignoring it has to be a complete answer.
const invite = mod.guardInvite({ estateName: '<b>Acme</b> Estate' });
const invitePlain = `${invite.html}\n${invite.text}`;
ok('a guard invitation says nothing changes until it is accepted',
  /nothing changes until you accept/i.test(invite.text) && /nothing changes until you accept/i.test(invite.html));
ok('...tells them to sign in with the account they already have',
  /existing account/i.test(invite.text));
ok('...carries no link or password to act on',
  !/https?:\/\/(?!myestateaccess\.com\/privacy)/.test(invite.text) && !/password:/i.test(invitePlain));
ok('...and escapes the estate name an admin typed', !invite.html.includes('<b>Acme</b>'));

// The payout-account alert goes to every admin and the operators. It must
// say where money now goes without handing out the account number.
const payout = mod.settlementChanged({
  estateName: '<i>Acme</i>', bankName: 'GTBank', accountLast4: '6789', accountName: 'ACME ESTATE',
  changedBy: 'ada@example.com', changedAt: '8 Oct 2026, 10:00 (Lagos)',
});
ok('the payout alert names the bank and the last four digits',
  payout.text.includes('GTBank ending 6789') && payout.html.includes('6789'));
ok('...says who changed it and when', payout.text.includes('ada@example.com') && payout.text.includes('8 Oct 2026'));
ok('...tells an admin who did not expect it what to do', /did not expect this change/i.test(payout.text));
ok('...and escapes the estate name', !payout.html.includes('<i>Acme</i>'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
