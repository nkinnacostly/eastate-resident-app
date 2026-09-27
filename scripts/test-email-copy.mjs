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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
