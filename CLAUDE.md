@AGENTS.md

# CLAUDE.md — Estate Access Platform

Guidance for Claude Code working in this repository. Read this before making changes.

---

## What this project is

Multi-tenant platform for estate visitor access. A resident generates a short one-time code, forwards it to a visitor, and the on-duty guard verifies it at the gate. Codes are single-use and expire after 6 hours. The guard app must verify **offline** and sync later.

**Surfaces**

- Resident app — React Native (Expo) — generates codes.
- Guard app — React Native (Expo) — verifies codes; has a local offline store.
- Estate admin dashboard — React (web) — manages residents/guards, views logs.
- Platform owner dashboard — React (web) — onboards estates.
- Backend — **Supabase** (Postgres + Auth + Edge Functions + Cron + Queues). No bespoke API layer: clients use `supabase-js`, writes go through `SECURITY DEFINER` RPCs, reads are constrained by RLS.

The **Technical Design** and **PRD** documents are the source of truth. Do not contradict them silently. If a task conflicts with them or exposes a gap, stop and flag it.

---

## Locked design decisions — do not relitigate

- **Users + memberships.** One human = one `users` row. A `memberships` row links a user to an estate and carries a `role` (`resident` | `guard` | `admin`). Move-out = deactivate membership. Never model role as a separate account type.
- **Codes:** short alphanumeric (charset excludes ambiguous glyphs: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), 6-hour expiry, one-time use.
- **Code status is `active` | `used` | `revoked` — there is no stored `expired`.** Expiry is derived from `expires_at > now()`, which every query already checks. Revocation (admin cut someone off) is a separate state with a reason and an actor, so the audit trail can distinguish it from a code that simply timed out. See Technical Design §2.4.
- **One guard verifies at a time** (shift rotation). This assumption is what makes offline verification safe — don't design as if two guards verify simultaneously.
- **Max 3 active codes per resident.** Enforced by `mint_access_code`, a plpgsql function that takes `pg_advisory_xact_lock` on the membership *before* counting. A single `INSERT ... WHERE (SELECT count ...) < 3` is **not** sufficient — under READ COMMITTED each statement snapshots at statement start, so two concurrent requests are phantoms to each other and both pass. `supabase-js` also cannot open a multi-statement transaction, so there is nowhere else the check could live. See Technical Design §3.1 before touching this.
- **Every RPC derives identity from `auth.uid()`.** Never add a `p_membership_id` (or `p_user_id`) parameter to a `SECURITY DEFINER` function — a client-supplied membership id is a forged identity. `p_estate_id` *is* passed by the client, but the function verifies an active membership at that estate before doing anything. See `current_membership()` in Technical Design §2.9.
- **RLS needs a matching GRANT — policies alone do nothing.** Postgres checks table privileges *before* policies, so a SELECT policy without `GRANT SELECT` fails with `42501` and looks like a correct policy list. Conversely, functions are granted `EXECUTE` to `PUBLIC` by default, so every RPC is anon-callable until you explicitly `REVOKE ... FROM PUBLIC`. Both were real bugs here. After any migration touching policies or functions, run `npm run db:advisors`.
- **Verify invariants against the database, not by reading SQL.** `npm run test:db` runs the checked-in suite (cap, one-time burn, replay dedupe, tenant isolation, no-write-path, rate limiting). Each RPC call must be its **own transaction** — several calls inside one SQL statement share a command id, so the cap check can't see earlier inserts and every call falsely succeeds.
- **`access_codes` and `verification_events` have no client write policy.** RLS is enabled with SELECT policies only; the sole write path is a `SECURITY DEFINER` function. Do not add an INSERT/UPDATE/DELETE policy to either table — that missing policy is what stops someone burning a code outside the atomic path.
- **Every `SECURITY DEFINER` function sets `search_path = ''`** and fully qualifies names (`public.access_codes`). Definer-rights functions without this are search-path hijackable.
- **The service role key never ships to a client.** It bypasses RLS entirely and lives only in Edge Function secrets.
- **Verification and generation are server-side and atomic.** Never let a client burn a code directly. The burn is a conditional `UPDATE ... WHERE status='active' AND expires_at > now()`, and it lives in exactly one place: `ingest_verification_event`. Online verify and offline replay are the same function with a different `source`.
- **Offline model:** guard app keeps a local SQLite pool of active unexpired codes for its estate, burns locally when offline, queues events, replays on reconnect. Three rules that are easy to get wrong:
  - **Dedupe before collision.** Ingest claims the `client_event_id` first (`ON CONFLICT DO NOTHING`), and only a burn against a code burned by a *different* event is a collision. Reverse the order and every retried push after a lost ack reports a false double-entry.
  - **The client id is not the primary key.** Dedupe on `UNIQUE (verified_by_membership_id, client_event_id)` with a server-generated PK — a client's uniqueness claim must not span other tenants' rows.
  - **`/sync/pull` must be able to retract.** It returns `{ upserts, tombstones, cursor }` against a server-owned `sync_seq`. An additive-only feed can never tell a device a code was revoked.
  Collisions are detected server-side, logged, and surfaced to the admin — never silently dropped.
- **Tenant isolation:** every estate-scoped query filters on `estate_id`. Never trust a client-supplied estate id without verifying the caller's active membership.
- **Every verification attempt is logged, failures included.** `outcome = 'rejected'` + `reject_reason`. `code_id` is nullable so an unresolvable code string still produces a record.
- **Rate-limit counters must survive a rejected request.** Never `RAISE EXCEPTION` for an expected outcome in `mint_access_code` — it aborts the transaction and rolls the counter back with it, so the limiter would count only successful mints. Return a status row; the API maps it to 409/429.
- **Background work is Supabase Cron → Edge Function → Expo** (Technical Design §6.3). Notifications are enqueued with `pgmq.send` inside the same transaction as the burn, never sent inline.
- **Auth is Supabase Auth.** `profiles` is keyed 1:1 to `auth.users`; we don't hash passwords or manage sessions. Membership is resolved per-call, **not** carried as a JWT custom claim — claims go stale exactly where staleness is dangerous (a deactivated membership would keep working until refresh).
- **RN session storage needs a `LargeSecureStore` adapter.** A Supabase session exceeds `expo-secure-store`'s ~2048-byte value limit. Keep an AES key in SecureStore and the encrypted session in AsyncStorage (Technical Design §7.1). Never put a raw session in AsyncStorage.
- **Never order by device time.** `verified_at` is the device's claim and is what humans read; ordering and reconciliation use the server's `synced_at` / `sync_seq`. Phone clocks drift by minutes, and one device set to the wrong year would poison ordering permanently.
- **Revocation is not instant at an offline gate.** Bounded by `max(pull interval, outage length)` and capped at 6h by the code's own expiry. A stale pool still admits — refusing to verify on stale data turns a network outage into a gate outage. This is deliberate; don't "fix" it. Technical Design §5.4, §11.

---

## Mandatory: verify best practices before writing code

Your training data may be stale. **Before implementing anything involving the tools below, search the web AND the library's GitHub repo for current best practices, the latest stable version, and known issues. Do not code from memory.**

Applies to:

- **Expo / React Native** — SDK version, project scaffolding, `expo-sqlite`, `expo-notifications`, `expo-secure-store`, background tasks, new architecture, deprecated APIs.
- **Supabase** — `supabase-js` version and RN setup, Auth, RLS policy patterns and performance, Edge Functions runtime (Deno + npm compat), Cron, Queues/pgmq, CLI migrations, current limits.
- **Offline store** — `expo-sqlite` vs WatermelonDB: check maintenance status and current sync patterns before choosing.
- **Auth** — multi-tenant token/session patterns, secure token storage on RN.
- **Any package** — confirm latest stable version and that the pattern is still current before adding it.

When you search:

- Prefer **official docs** and the **project's GitHub** (README, latest release/tag, recent commit activity, relevant open issues) over blogs/forums.
- Confirm the library is **actively maintained** before adopting it.
- Note the version/date you relied on in your explanation or a code comment.
- If sources conflict, surface the tradeoff — don't pick silently.

Do NOT waste searches on settled fundamentals (basic SQL, core JS/TS). Search when the answer depends on a **current version, a moving API, or a current best practice** — which covers most of the Expo/Supabase surface here.

---

## Working conventions

- **TypeScript** across mobile and web.
- Match the current Expo SDK / RN patterns you verified — not older ones from memory.
- Keep verification/generation logic on the server; mobile clients call the API.
- Never use browser storage APIs in web artifacts; use component state or the real backend.
- Write focused changes. Explain non-obvious consequences (e.g. offline-burn notifications are delayed until reconnect; the cap needs a transaction).
- When a task hides an undecided question, ask before assuming.

## Expo / React Native technical rules (verified, follow strictly)

These reflect the current Expo tooling (verified against official Expo docs, Aug 2026). Re-check on any SDK bump — Expo ships ~3 SDKs a year.

- **Install packages with `npx expo install <pkg>`, never plain `npm install <pkg>`.** The Expo CLI resolves the version that matches the project's SDK and prevents version-mismatch breakage. This applies to every Expo/RN dependency, including this project's: `npx expo install expo-sqlite expo-notifications expo-secure-store expo-crypto @react-native-async-storage/async-storage`. Only use `npm install` for pure-JS packages with no native/SDK coupling — `@supabase/supabase-js` is one of those. (AsyncStorage and expo-crypto are needed by the `LargeSecureStore` session adapter, not optional extras.)
- **Scaffold with `create-expo-app`** (`npx create-expo-app@latest <name>`). It prompts for an SDK template.
  - If the app must run in **Expo Go on a physical device**, scaffold **SDK 54** (Expo Go only supports the latest published SDK line; older lines aren't supported in Expo Go).
  - Otherwise use a **development build** and a newer template (e.g. `--template default@sdk-57`).
  - **This project needs a development build**, not Expo Go, because the guard app uses `expo-notifications` (push) and native modules — those outgrow Expo Go quickly. Plan for a dev build from the start; don't design around Expo Go and hit a wall.
- **Auto-generated agent files:** `create-expo-app` now generates its own `CLAUDE.md`, `AGENTS.md`, and `.claude/settings.json` inside the app folder, wiring the Expo skills plugin and SDK-versioned doc links. **Do not overwrite this repo's root CLAUDE.md with it, and don't delete Expo's** — keep both: Expo's per-app file carries SDK-specific context Claude Code uses; this root file carries the project's locked design. Merge, don't clobber.
- **Routing:** the default template ships **Expo Router** (file-based routing under `app/`). Build screens around the `app/` directory convention; don't hand-roll React Navigation unless there's a specific reason.
- **Secure token storage:** use `expo-secure-store` for auth tokens on device — never `AsyncStorage`/plain storage for credentials.
- **Local offline store:** default to `expo-sqlite` for the guard's pool unless a search shows a better-maintained fit; verify its current API before writing queries.
- Before adding any Expo package, confirm it's included in / compatible with the project's SDK version.

## Build order (follow unless told otherwise)

1. Supabase schema + migrations (including RLS policies and the RPCs) — via the Supabase CLI, checked in, not dashboard edits.
2. Auth + membership resolution.
3. Code generation (with 3-cap + rate limit) + online verification.
4. Resident code history.
5. Guard offline store + sync.
6. Push notifications (Expo).
7. Estate admin dashboard.
8. Platform owner dashboard.

## Before you finish a change

- Does it contradict the PRD / Technical Design or a locked decision? If so, stop and flag.
- Did you verify any version-dependent API against current docs/GitHub?
- Did you use `npx expo install` (not `npm install`) for any Expo/RN dependency?
- Is estate-level isolation preserved — RLS policy present on any new table, and `estate_id` checked in any new RPC?
- Does any new `SECURITY DEFINER` function derive identity from `auth.uid()`, set `search_path = ''`, and grant EXECUTE to `authenticated` only?
- Is any code-burning path still atomic, and does it go through `_ingest_verification_event`?
- Does any new query read `status` where it should derive expiry from `expires_at > now()`?
- Does any new sync or ingest path stay idempotent per `client_event_id`?
