/**
 * Email templates for the Estate Access platform.
 *
 * Shared by `send-emails` (queue-driven: estate and landlord onboarding) and
 * `auth-emails` (Supabase's Send Email Hook: sign-up verification), so every
 * message the platform sends looks like it came from the same product.
 *
 * WHY THIS LOOKS LIKE 2005 HTML
 *
 * Email clients are not browsers. Outlook renders with Word's engine, Gmail
 * strips <style> blocks in some contexts and rewrites classes, and flexbox and
 * grid are unreliable across the set. So: tables for layout, inline styles on
 * every element, no external CSS, no web fonts, 600px fixed width. This is not
 * carelessness — it is what survives the render.
 *
 * DELIVERABILITY IS A DESIGN CONSTRAINT HERE, NOT AN AFTERTHOUGHT
 *
 * The things below are what keep these out of spam, and each is easy to undo by
 * accident:
 *   - Every message ships a real plain-text alternative. An HTML-only email is
 *     one of the strongest spam signals there is.
 *   - No image-only content, no tracking pixel, no link shorteners.
 *   - One clear call to action, real sentences, and a physical-world reason the
 *     recipient is being written to.
 *   - The visible From name and the envelope domain agree, and the domain is
 *     DKIM/SPF signed. Without that DNS work no amount of markup helps.
 */

// ─── Brand ───────────────────────────────────────────────────────────────────
// Lifted from tailwind.config.js so email and app cannot drift apart.
const INK = '#16181c';
const LIME = '#cdf24a';
const CANVAS = '#f7f9fb';
const MUTED = '#6b7280';
const HAIR = '#e6eaf0';
const WHITE = '#ffffff';

/**
 * System font stack rather than Plus Jakarta Sans.
 *
 * Web fonts do not load in Outlook, Gmail's app or most desktop clients, and a
 * @font-face that fails falls back to Times New Roman — which looks broken next
 * to the rest of the design. A system stack renders as the recipient's own UI
 * font everywhere and never falls back to a serif.
 */
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export interface RenderedEmail {
  subject: string;
  html: string;
  /** Never omit. An HTML-only message is a spam signal, and a hand-written text part reads better than any synthesised one. */
  text: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The shell every message shares.
 *
 * `preheader` is the grey line the inbox shows next to the subject. Left unset
 * clients scrape the first text they find — usually "View in browser" or the
 * logo alt text — which looks careless in a list of messages.
 */
function shell(opts: {
  preheader: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footnote?: string;
}): string {
  const { preheader, heading, body, cta, footnote } = opts;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};">
  <!-- Preheader: shown in the inbox list, hidden in the message itself. The
       trailing whitespace stops clients from pulling body copy in after it. -->
  <div style="display:none;font-size:1px;color:${CANVAS};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CANVAS};">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">

          <!-- Wordmark. Text, not an image: most clients block remote images by
               default, and a logo that does not load is a blank first
               impression. -->
          <tr>
            <td style="padding:0 0 20px 4px;font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:-0.2px;color:${INK};">
              myestateaccess
            </td>
          </tr>

          <tr>
            <td style="background-color:${WHITE};border-radius:16px;border:1px solid ${HAIR};padding:36px 32px;">
              <h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:24px;line-height:31px;font-weight:700;letter-spacing:-0.4px;color:${INK};">
                ${esc(heading)}
              </h1>
              ${body}
              ${
                cta
                  ? `
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px 0;">
                <tr>
                  <td style="background-color:${LIME};border-radius:999px;">
                    <a href="${esc(cta.url)}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};text-decoration:none;">${esc(cta.label)}</a>
                  </td>
                </tr>
              </table>
              <!-- The raw URL as well as the button. Some clients strip the
                   anchor styling entirely, and a recipient who cannot see a
                   button must still be able to reach the link. -->
              <p style="margin:16px 0 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:${MUTED};word-break:break-all;">
                Or paste this into your browser:<br><span style="color:${MUTED};">${esc(cta.url)}</span>
              </p>`
                  : ''
              }
            </td>
          </tr>

          ${
            footnote
              ? `
          <tr>
            <td style="padding:20px 8px 0 8px;font-family:${FONT};font-size:13px;line-height:19px;color:${MUTED};">
              ${footnote}
            </td>
          </tr>`
              : ''
          }

          <tr>
            <td style="padding:24px 8px 0 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};">
              You are receiving this because your estate uses myestateaccess for visitor access.
              This is a service message about your account, not marketing.
              <br><br>
              <a href="https://myestateaccess.com/privacy" style="color:${MUTED};text-decoration:underline;">Privacy policy</a>
              &nbsp;·&nbsp;
              <a href="mailto:hello@myestateaccess.com" style="color:${MUTED};text-decoration:underline;">hello@myestateaccess.com</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:23px;color:${INK};">${text}</p>`;
}

function muted(text: string): string {
  return `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:23px;color:${MUTED};">${text}</p>`;
}

/** A short code shown big enough to read off a screen and type on a phone. */
function codeBlock(label: string, code: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;width:100%;">
    <tr>
      <td style="background-color:${CANVAS};border:1px solid ${HAIR};border-radius:12px;padding:18px 22px;">
        <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};">${esc(label)}</div>
        <div style="margin-top:6px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:5px;color:${INK};">${esc(code)}</div>
      </td>
    </tr>
  </table>`;
}

// ─── 1. Estate onboarded → the estate admin ──────────────────────────────────

export function estateAdminWelcome(v: {
  adminName: string | null;
  estateName: string;
  estateJoinCode: string;
  dashboardUrl: string;
  setPasswordUrl: string | null;
}): RenderedEmail {
  const greeting = v.adminName ? `Hi ${v.adminName},` : 'Hi,';

  const body =
    p(esc(greeting)) +
    p(
      `<strong>${esc(v.estateName)}</strong> is now set up on myestateaccess, and you have been made its administrator.`,
    ) +
    p(
      'From the dashboard you can add houses, approve residents who ask to join, register guards, and read the gate log.',
    ) +
    codeBlock(`${v.estateName} join code`, v.estateJoinCode) +
    muted(
      'Residents need this code to request access to the estate, along with the code for their own house. Share it with residents — not with visitors.',
    );

  const cta = v.setPasswordUrl
    ? { label: 'Set your password', url: v.setPasswordUrl }
    : { label: 'Open your dashboard', url: v.dashboardUrl };

  const footnote = v.setPasswordUrl
    ? `This link signs you in once so you can choose a password, and expires in 24 hours. If it has expired, go to <a href="${esc(v.dashboardUrl)}" style="color:${MUTED};">the dashboard</a> and choose “Forgot password”.`
    : undefined;

  return {
    subject: `${v.estateName} is ready on myestateaccess`,
    html: shell({
      preheader: `You are the administrator for ${v.estateName}. Set your password to get started.`,
      heading: 'Your estate is ready',
      body,
      cta,
      footnote,
    }),
    text: [
      greeting,
      '',
      `${v.estateName} is now set up on myestateaccess, and you have been made its administrator.`,
      '',
      'From the dashboard you can add houses, approve residents who ask to join, register guards, and read the gate log.',
      '',
      `${v.estateName.toUpperCase()} JOIN CODE: ${v.estateJoinCode}`,
      '',
      'Residents need this code to request access to the estate, along with the code for their own house.',
      'Share it with residents, not with visitors.',
      '',
      v.setPasswordUrl
        ? `Set your password: ${v.setPasswordUrl}\n(This link expires in 24 hours. If it has expired, use "Forgot password" at ${v.dashboardUrl}.)`
        : `Open your dashboard: ${v.dashboardUrl}`,
      '',
      '—',
      'You are receiving this because your estate uses myestateaccess for visitor access.',
      'Privacy policy: https://myestateaccess.com/privacy',
      'Questions: hello@myestateaccess.com',
    ].join('\n'),
  };
}

// ─── 1b. Guard registered by an estate admin → the guard ─────────────────────
//
// Sent when an estate admin registers a guard. Unlike the admin and landlord
// mails there is no code to pass on and no dashboard to open: a guard's whole
// job lives in the guard app, so the only thing this needs to do is get them
// signed in and say what the app is for.
//
// No password in here, same as every other mail we send. The admin has it on
// screen for the in-person handover; this link is the route for a guard who
// would rather set their own.

export function guardWelcome(v: {
  guardName: string | null;
  estateName: string | null;
  setPasswordUrl: string | null;
  /** Where "Forgot password" lives. The guard app has no reset screen of its own. */
  dashboardUrl: string;
}): RenderedEmail {
  const greeting = v.guardName ? `Hi ${v.guardName},` : 'Hi,';
  const at = v.estateName ? ` at <strong>${esc(v.estateName)}</strong>` : '';
  const atPlain = v.estateName ? ` at ${v.estateName}` : '';

  const body =
    p(esc(greeting)) +
    p(`You have been registered as a guard${at} on myestateaccess.`) +
    p(
      'When a resident expects a visitor they generate a one-time code and send it on. At the gate you enter that code in the myestateaccess guard app and it tells you straight away whether to let the person through. Codes work once and expire after six hours.',
    ) +
    p(
      'Start your shift when you come on duty. Residents are told who is on the gate, and every entry you record is kept in the estate\u2019s log.',
    ) +
    muted(
      'The app keeps working when the gate has no signal \u2014 codes are checked on the phone itself and sync when the connection returns.',
    );

  const cta = v.setPasswordUrl ? { label: 'Set your password', url: v.setPasswordUrl } : undefined;

  const footnote = v.setPasswordUrl
    ? `This link signs you in once so you can choose a password, and expires in 24 hours. If it has expired, or your estate gave you a password in person, choose \u201cForgot password\u201d at <a href="${esc(v.dashboardUrl)}" style="color:${MUTED};">${esc(v.dashboardUrl.replace(/^https?:\/\//, ''))}</a>, then sign in to the guard app with your new password.`
    : undefined;

  return {
    subject: v.estateName
      ? `You are registered as a guard at ${v.estateName}`
      : 'You are registered as a guard on myestateaccess',
    html: shell({
      preheader: `You have been registered as a guard${atPlain}. Set your password to sign in.`,
      heading: 'You are on the gate',
      body,
      cta,
      footnote,
    }),
    text: [
      greeting,
      '',
      `You have been registered as a guard${atPlain} on myestateaccess.`,
      '',
      'When a resident expects a visitor they generate a one-time code and send it on. At the gate you enter that code in the myestateaccess guard app and it tells you straight away whether to let the person through. Codes work once and expire after six hours.',
      '',
      'Start your shift when you come on duty. Residents are told who is on the gate, and every entry you record is kept in the estate log.',
      '',
      'The app keeps working when the gate has no signal: codes are checked on the phone itself and sync when the connection returns.',
      '',
      v.setPasswordUrl
        ? `Set your password: ${v.setPasswordUrl}\n(This link expires in 24 hours. If it has expired, or your estate gave you a password in person, choose "Forgot password" at ${v.dashboardUrl}, then sign in to the guard app with your new password.)`
        : 'Your estate will give you your password.',
      '',
      '\u2014',
      'You are receiving this because an estate registered you as a guard on myestateaccess.',
      'Privacy policy: https://myestateaccess.com/privacy',
      'Questions: hello@myestateaccess.com',
    ].join('\n'),
  };
}

// ─── 2. Landlord onboarded → the landlord ────────────────────────────────────

export function landlordWelcome(v: {
  landlordName: string | null;
  estateName: string;
  houseNumber: string;
  houseCode: string;
  appUrl: string;
}): RenderedEmail {
  const greeting = v.landlordName ? `Hi ${v.landlordName},` : 'Hi,';

  const body =
    p(esc(greeting)) +
    p(
      `<strong>${esc(v.estateName)}</strong> has registered <strong>House ${esc(v.houseNumber)}</strong> on myestateaccess, the system the estate uses to let visitors through the gate.`,
    ) +
    p(
      'Anyone living at this house — you, or your tenants — uses the code below to link their account to it. They will also need the estate join code, which the estate provides.',
    ) +
    codeBlock(`House ${v.houseNumber} code`, v.houseCode) +
    muted(
      'Keep this for your records and give it only to people who live at the house. It is not a visitor code and will not open the gate on its own — an estate administrator approves every person who uses it.',
    );

  return {
    subject: `House ${v.houseNumber} at ${v.estateName} — your house code`,
    html: shell({
      preheader: `House ${v.houseNumber} has been registered. Your house code is ${v.houseCode}.`,
      heading: 'Your house is registered',
      body,
      cta: { label: 'Get the resident app', url: v.appUrl },
      footnote:
        'If you were not expecting this, someone at the estate has listed this address against your email. Reply to this message and we will look into it.',
    }),
    text: [
      greeting,
      '',
      `${v.estateName} has registered House ${v.houseNumber} on myestateaccess, the system the estate uses to let visitors through the gate.`,
      '',
      'Anyone living at this house — you, or your tenants — uses the code below to link their account to it.',
      'They will also need the estate join code, which the estate provides.',
      '',
      `HOUSE ${v.houseNumber.toUpperCase()} CODE: ${v.houseCode}`,
      '',
      'Keep this for your records and give it only to people who live at the house.',
      'It is not a visitor code and will not open the gate on its own — an estate administrator approves every person who uses it.',
      '',
      `Get the resident app: ${v.appUrl}`,
      '',
      'If you were not expecting this, someone at the estate has listed this address against your email.',
      'Reply to this message and we will look into it.',
      '',
      '—',
      'Privacy policy: https://myestateaccess.com/privacy',
      'Questions: hello@myestateaccess.com',
    ].join('\n'),
  };
}

// ─── 3. Sign-up → verify the address ─────────────────────────────────────────

export function verifyEmail(v: { confirmUrl: string; otp: string }): RenderedEmail {
  const body =
    p('Confirm this address to finish setting up your myestateaccess account.') +
    p(
      'Once it is confirmed you can ask to join your estate. An administrator there approves the request before you can generate any visitor codes.',
    ) +
    codeBlock('Or enter this code', v.otp) +
    muted('This link and code both expire in 60 minutes.');

  return {
    subject: 'Confirm your email address',
    html: shell({
      preheader: `Your confirmation code is ${v.otp}. It expires in 60 minutes.`,
      heading: 'Confirm your email',
      body,
      cta: { label: 'Confirm my email', url: v.confirmUrl },
      footnote:
        'If you did not create a myestateaccess account, you can ignore this message — nothing will be set up and no one gains access to anything.',
    }),
    text: [
      'Confirm this address to finish setting up your myestateaccess account.',
      '',
      'Once it is confirmed you can ask to join your estate. An administrator there approves',
      'the request before you can generate any visitor codes.',
      '',
      `Confirm your email: ${v.confirmUrl}`,
      '',
      `Or enter this code: ${v.otp}`,
      '',
      'This link and code both expire in 60 minutes.',
      '',
      'If you did not create a myestateaccess account, you can ignore this message —',
      'nothing will be set up and no one gains access to anything.',
      '',
      '—',
      'Privacy policy: https://myestateaccess.com/privacy',
      'Questions: hello@myestateaccess.com',
    ].join('\n'),
  };
}

// ─── Password reset (the hook receives these too) ────────────────────────────

export function resetPassword(v: { confirmUrl: string; otp: string }): RenderedEmail {
  const body =
    p('Someone asked to reset the password for this myestateaccess account.') +
    p('If it was you, use the button below to choose a new one.') +
    codeBlock('Or enter this code', v.otp) +
    muted('This link and code both expire in 60 minutes.');

  return {
    subject: 'Reset your password',
    html: shell({
      preheader: 'Choose a new password. This link expires in 60 minutes.',
      heading: 'Reset your password',
      body,
      cta: { label: 'Choose a new password', url: v.confirmUrl },
      footnote:
        'If you did not ask for this, ignore this message and your password stays as it is. Nobody can change it without the link above.',
    }),
    text: [
      'Someone asked to reset the password for this myestateaccess account.',
      'If it was you, use the link below to choose a new one.',
      '',
      `Reset your password: ${v.confirmUrl}`,
      '',
      `Or enter this code: ${v.otp}`,
      '',
      'This link and code both expire in 60 minutes.',
      '',
      'If you did not ask for this, ignore this message and your password stays as it is.',
      'Nobody can change it without the link above.',
      '',
      '—',
      'Privacy policy: https://myestateaccess.com/privacy',
      'Questions: hello@myestateaccess.com',
    ].join('\n'),
  };
}

// ─── Password reset, code only (the mobile apps) ─────────────────────────────
//
// A SECOND reset template, deliberately, rather than a flag on the one above.
// The difference is not cosmetic — it is which artefact the reader is meant to
// act on, and the two cannot share a layout without one of them lying.
//
// `resetPassword` is what the Send Email Hook renders: it leads with a button,
// because a browser is on the other end and a click is the shortest path.
//
// This one leads with the code and has NO link at all, for three reasons that
// all apply on a phone:
//
//   1. There is nowhere for a link to go. The project's Site URL is still the
//      CLI default, and the apps register no universal/app link, so an emailed
//      link resolves to localhost — a dead address on a handset.
//   2. The mail is very often opened on a different device from the one being
//      reset. A code crosses that gap; a deep link does not.
//   3. Corporate and consumer link scanners fetch URLs in incoming mail to
//      check them. A one-time recovery link is CONSUMED by that fetch, so the
//      reset dies before the recipient touches it. A code is not clickable and
//      survives.
//
// Keep both. Deleting the linked version would break the hook the moment it is
// enabled; folding them together would put a dead button in this one.

export function resetPasswordCode(v: { otp: string }): RenderedEmail {
  const body =
    p('Someone asked to reset the password for this myestateaccess account.') +
    p('If it was you, enter this code on the screen where you asked for it, and choose a new password.') +
    codeBlock('Your reset code', v.otp) +
    muted('The code expires in 60 minutes and can only be used once.');

  return {
    subject: 'Your password reset code',
    html: shell({
      preheader: 'Your reset code expires in 60 minutes.',
      heading: 'Reset your password',
      body,
      // No cta on purpose — see the note above.
      footnote:
        'If you did not ask for this, ignore this message and your password stays as it is. Nobody can change it without the code above, and we will never ask you for it.',
    }),
    text: [
      'Someone asked to reset the password for this myestateaccess account.',
      'If it was you, enter this code on the screen where you asked for it, and choose a new password.',
      '',
      `Your reset code: ${v.otp}`,
      '',
      'The code expires in 60 minutes and can only be used once.',
      '',
      'If you did not ask for this, ignore this message and your password stays as it is.',
      'Nobody can change it without the code above, and we will never ask you for it.',
      '',
      '—',
      'Privacy policy: https://myestateaccess.com/privacy',
      'Questions: hello@myestateaccess.com',
    ].join('\n'),
  };
}

// ─── Sign-up verification, code only (the mobile apps) ───────────────────────
//
// The signup counterpart to resetPasswordCode, and it exists for one extra
// reason beyond that one's three.
//
// A resident signing up has ALREADY typed their estate code and house code into
// the app. Those two values only become a join request once there is a session
// to submit them under, so the app holds them in memory and submits them the
// moment verification succeeds. That only works if verification happens IN THE
// APP.
//
// A link breaks it. Clicking one confirms the account in a browser, consumes
// the one-time token, and leaves the app sitting on a code screen whose code
// will now be refused — with the two join codes still stranded in memory and no
// way to spend them. The person then lands on /join and has to find codes their
// landlord sent them days ago.
//
// So this template has no link at all. There is exactly one way to finish, and
// it is the way that keeps their codes.

export function verifyEmailCode(v: { otp: string }): RenderedEmail {
  const body =
    p('Welcome to myestateaccess.') +
    p('Enter this code in the app to confirm your email address and finish setting up your account.') +
    codeBlock('Your confirmation code', v.otp) +
    muted('The code expires in 60 minutes and can only be used once.');

  return {
    subject: 'Confirm your email address',
    html: shell({
      preheader: 'Your confirmation code expires in 60 minutes.',
      heading: 'Confirm your email',
      body,
      // No cta on purpose — see the note above.
      footnote:
        'If you did not create an account, ignore this message and nothing further will happen. We will never ask you for this code.',
    }),
    text: [
      'Welcome to myestateaccess.',
      'Enter this code in the app to confirm your email address and finish setting up your account.',
      '',
      `Your confirmation code: ${v.otp}`,
      '',
      'The code expires in 60 minutes and can only be used once.',
      '',
      'If you did not create an account, ignore this message and nothing further will happen.',
      'We will never ask you for this code.',
      '',
      '—',
      'Privacy policy: https://myestateaccess.com/privacy',
      'Questions: hello@myestateaccess.com',
    ].join('\n'),
  };
}

// ─── 9. Estate dues falling due ──────────────────────────────────────────────

/**
 * One template, two quite different letters.
 *
 * A LANDLORD is being asked to pay a bill, and gets a link that works without
 * an account — they have no login, by design.
 *
 * A RESIDENT of a house-billed estate is being warned about something they
 * cannot fix. Sending them a payment link would be sending someone else's bill
 * to a tenant, so they are told who is responsible and what happens if it is
 * not settled. That distinction is the whole reason this is not two lines of
 * mail-merge.
 */
export function duesReminder(v: {
  recipientName: string | null;
  /** 'landlord' pays it; 'resident' is affected by it. */
  role: 'landlord' | 'resident';
  /** True when the estate bills the house rather than the resident. */
  landlordPays: boolean;
  estateName: string;
  houseNumber: string | null;
  amount: string;
  dueOn: string;
  daysLeft: number;
  /** Only ever set for a landlord. */
  payUrl: string | null;
  appUrl: string;
  /**
   * True only where the estate has authorised pausing new visitor codes for
   * arrears. Otherwise the email must not mention that consequence at all: it
   * would be threatening a sanction the estate never adopted.
   */
  codesPause: boolean;
}): RenderedEmail {
  const greeting = v.recipientName ? `Hi ${v.recipientName},` : 'Hi,';
  const where = v.houseNumber
    ? `House ${v.houseNumber} at ${v.estateName}`
    : v.estateName;
  const when =
    v.daysLeft <= 0
      ? 'is now overdue'
      : v.daysLeft === 1
        ? 'is due tomorrow'
        : `is due in ${v.daysLeft} days`;

  // A landlord: yours to pay, here is the link.
  if (v.role === 'landlord') {
    const body =
      p(esc(greeting)) +
      p(
        `The estate dues for <strong>${esc(where)}</strong> ${esc(when)} — <strong>${esc(v.amount)}</strong>, due ${esc(v.dueOn)}.`,
      ) +
      p(
        'You can settle it with the button below. No account or sign-in is needed.',
      ) +
      (v.codesPause
        ? muted(
            'If it is not paid, the people living at the house will not be able to generate NEW visitor codes. Their own access to the estate is unaffected, and any code they have already shared keeps working until it expires.',
          )
        : '');

    return {
      subject: `${v.amount} due — estate dues for ${where}`,
      html: shell({
        preheader: `${v.amount} ${when}.`,
        heading: 'Estate dues are due',
        body,
        cta: v.payUrl ? { label: `Pay ${v.amount}`, url: v.payUrl } : undefined,
        footnote:
          'If you no longer own this property, reply to this message and we will pass it on to the estate.',
      }),
      text: [
        greeting,
        '',
        `The estate dues for ${where} ${when} — ${v.amount}, due ${v.dueOn}.`,
        '',
        v.payUrl ? `Pay here (no account needed): ${v.payUrl}` : '',
        '',
        ...(v.codesPause
          ? [
              'If it is not paid, the people living at the house will not be able to generate',
              'NEW visitor codes. Their own access to the estate is unaffected, and any code',
              'they have already shared keeps working until it expires.',
              '',
            ]
          : []),
        'If you no longer own this property, reply and we will pass it on to the estate.',
        '',
        '—',
        'Privacy policy: https://myestateaccess.com/privacy',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  // A resident in a house-billed estate: not yours to pay, but it will affect
  // you. No payment link — that would be sending a tenant somebody else's bill.
  if (v.landlordPays) {
    const body =
      p(esc(greeting)) +
      p(
        `The estate dues for <strong>${esc(where)}</strong> ${esc(when)} — <strong>${esc(v.amount)}</strong>, due ${esc(v.dueOn)}.`,
      ) +
      p(
        'These dues are billed to the owner of the house rather than to you. We have written to them as well.',
      ) +
      muted(
        (v.codesPause
          ? 'If they are not settled, you will not be able to generate NEW visitor codes until they are. Your own access to the estate is unaffected, and any code you have already shared keeps working until it expires. '
          : '') + 'The app shows the owner’s contact details if you need to chase it.',
      );

    return {
      subject: `Estate dues for ${where} ${when}`,
      html: shell({
        preheader: `${v.amount} ${when}. Billed to the owner, not to you.`,
        heading: 'A heads-up about your estate dues',
        body,
        cta: { label: 'Open the app', url: v.appUrl },
        footnote: v.codesPause
          ? 'You are receiving this because you live at this house and unpaid dues would affect your visitor codes.'
          : 'You are receiving this because you live at this house.',
      }),
      text: [
        greeting,
        '',
        `The estate dues for ${where} ${when} — ${v.amount}, due ${v.dueOn}.`,
        '',
        'These dues are billed to the owner of the house rather than to you.',
        'We have written to them as well.',
        '',
        ...(v.codesPause
          ? [
              'If they are not settled, you will not be able to generate NEW visitor codes',
              'until they are. Your own access to the estate is unaffected, and any code you',
              'have already shared keeps working until it expires.',
              '',
            ]
          : []),
        `Open the app: ${v.appUrl}`,
        '',
        '—',
        'Privacy policy: https://myestateaccess.com/privacy',
      ].join('\n'),
    };
  }

  // A resident who is billed directly: theirs to pay, in the app.
  const body =
    p(esc(greeting)) +
    p(
      `Your estate dues at <strong>${esc(v.estateName)}</strong> ${esc(when)} — <strong>${esc(v.amount)}</strong>, due ${esc(v.dueOn)}.`,
    ) +
    p('You can pay in the app in a few taps.') +
    (v.codesPause
      ? muted(
          'If they are not settled you will not be able to generate NEW visitor codes until they are. Your own access to the estate is unaffected, and any code you have already shared keeps working until it expires.',
        )
      : '');

  return {
    subject: `${v.amount} due — your estate dues at ${v.estateName}`,
    html: shell({
      preheader: `${v.amount} ${when}.`,
      heading: 'Your estate dues are due',
      body,
      cta: { label: 'Pay in the app', url: v.appUrl },
      footnote:
        'If you think this is a mistake, speak to your estate office — they can waive or correct a charge.',
    }),
    text: [
      greeting,
      '',
      `Your estate dues at ${v.estateName} ${when} — ${v.amount}, due ${v.dueOn}.`,
      '',
      `Pay in the app: ${v.appUrl}`,
      '',
      ...(v.codesPause
        ? [
            'If they are not settled you will not be able to generate NEW visitor codes',
            'until they are. Your own access to the estate is unaffected, and any code you',
            'have already shared keeps working until it expires.',
            '',
          ]
        : []),
      '—',
      'Privacy policy: https://myestateaccess.com/privacy',
    ].join('\n'),
  };
}
