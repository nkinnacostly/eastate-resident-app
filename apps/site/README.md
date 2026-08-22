# myestateaccess — marketing site

Four static pages: `index.html`, `about.html`, `contact.html`, `privacy.html`.
No build step and no dependencies — the whole thing is HTML, one stylesheet and
about forty lines of progressive-enhancement JavaScript on the contact form.

It is deliberately not a Vite app. A marketing site's job is to be crawled and
to render instantly; a framework would add a build, a bundle and a hydration
step in exchange for nothing these four pages need.

## Local preview

    npx serve apps/site

`npx serve` resolves extensionless URLs the way Vercel's `cleanUrls` does.
`python3 -m http.server` does not, so `/about`, `/contact` and `/privacy` 404
under it even though they are correct in production.

## Deploying

This is a **separate Vercel project** from the dashboard. Each app owns its
own deploy config — `apps/site/vercel.json` here, `apps/web/vercel.json` for the
dashboard — and Vercel reads whichever one sits in that project's Root
Directory. There is deliberately no `vercel.json` at the repo root: a project
rooted there would pick it up and build the wrong app.

1. New Vercel project from the same repository.
2. **Root Directory:** `apps/site`
3. **Framework preset:** Other. No build command, no output directory — the
   files are served as they are.

`cleanUrls` serves `/about` as well as `/about.html`.

## Before it goes live

Placeholders that must be replaced:

- `myestateaccess.com` — appears in every canonical URL, `og:url`, the JSON-LD and
  `sitemap.xml`. Search and replace across the directory.
- `hello@myestateaccess.com`, `support@myestateaccess.com` and
  `privacy@myestateaccess.com` — the last one is the POPIA contact address and
  has to reach a real mailbox someone reads, not an alias that bounces.
- `sitemap.xml` `<lastmod>` dates.

`privacy.html` additionally carries square-bracket placeholders that a search
for `— to be confirmed]` will find. **It must not go live with any of them
still in place**, and it has not been reviewed by a lawyer:

| placeholder | where it comes from |
|---|---|
| Information Officer's name | POPIA requires one to be designated and registered with the Regulator |
| Registered company name, registration number, address | CIPC records |
| Gate-log retention period | a decision, not a lookup — nothing in the schema purges `verification_events` today, so whatever you write here has to be built |
| Post-closure deletion period | same |
| Supabase hosting region | Supabase project settings; the section 72 cross-border wording depends on it |

The privacy page also states things that are true of the system *as built* —
guards cannot see resident names until a code is issued, estates are isolated in
the database, codes expire in six hours, no analytics anywhere. If any of those
change, this page becomes a false statement about data handling rather than
merely a stale one. Treat it as part of the schema's blast radius.

The contact form composes a `mailto:` and opens the visitor's mail client; it
does **not** post anywhere, and the page says so plainly rather than implying a
message was sent. To make it a real form, point the submit handler at an
endpoint — the field names are already sensible.

## Colour rules, measured not assumed

Same tokens as the dashboards. Three of them are dangerous on light
backgrounds, so the rules are worth stating rather than rediscovering:

| pair | ratio | verdict |
|---|---|---|
| `lime` on `canvas` / `card` | **1.21:1** | never as text — background only |
| `muted-2` on `canvas` | **2.97:1** | dark backgrounds only |
| `muted` on `canvas` | 5.04:1 | safe for body text |
| `ink` on `lime` | 13.88:1 | the primary button |
| `muted-2` on `ink` | 5.67:1 | body text on dark bands |

Verified against the rendered pages rather than the stylesheet: 233 visible text
nodes measured with computed styles, all meeting WCAG 2.1 AA (4.5:1 body,
3:1 large text). One real failure was found this way — the header CTA inherited
`muted` from the more specific `.nav a` rule and landed at 3.34:1.

## Images

Hotlinked from Unsplash with `?auto=format`, so each browser gets AVIF or WebP.
Every photographer is credited in the footer with a link to their profile.
If you swap an image, check the new URL returns 200 at every width in the
`srcset` — and prefer photos not credited to "Getty Images", which on Unsplash
are paid Unsplash+ content.
