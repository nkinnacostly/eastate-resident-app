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
  /** Never omit. Resend will synthesise one, but a hand-written version reads better and scores better. */
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
