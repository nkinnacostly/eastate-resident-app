# Estate Access Platform

Multi-tenant visitor access for residential estates. A resident generates a
short one-time code, forwards it to their visitor, and the guard verifies it at
the gate — **offline if the network is down**, syncing when it returns.

Codes are single-use and expire after 6 hours.

**Read first:** [CLAUDE.md](CLAUDE.md) (locked design decisions),
[estate-access-prd.md](estate-access-prd.md) (product),
[estate-access-technical-design.md](estate-access-technical-design.md)
(architecture — the source of truth for everything below).

## Layout

```
apps/
  resident/     Expo SDK 54 — generate codes
  guard/        (not yet scaffolded) Expo + expo-sqlite offline pool
  web/          (not yet scaffolded) React — admin + platform owner, role-gated
packages/
  core/         domain constants + RPC contract types
  db/           generated Supabase types — DO NOT hand-edit src/types.ts
supabase/
  migrations/   schema, RLS policies, RPCs
  seed.sql
```

`apps/guard` and `apps/web` get scaffolded at their build step (5 and 7) with
`create-expo-app` / Vite respectively — see the build order in the technical
design. Scaffold them properly rather than hand-rolling; `create-expo-app`
generates its own per-app `CLAUDE.md` that should be kept alongside the root one.

## Getting started

```bash
npm install
npm run db:push         # apply migrations to the linked remote project
npm run db:types        # regenerate packages/db/src/types.ts from the remote
npm run resident        # Expo dev server
```

With Docker available you can work against a local stack instead —
`npm run db:start`, `npm run db:reset`, `npm run db:types:local`.

Client env vars live in the **app** directory, not the workspace root, and need
the framework's prefix: `apps/resident/.env.local` with `EXPO_PUBLIC_*`. The
anon key is meant to be public — RLS is what protects the data. The service
role key must never appear in any client env file.

**Regenerate types after every migration.** There is no API layer, so the RPC
signatures and the generated types are the entire contract — a stale
`types.ts` silently removes the only compile-time check on it.

## Things that will bite you

- **Never `npm install` an Expo/RN dependency.** Use `npx expo install <pkg>`
  from inside the app directory so the version matches the SDK.
- **`access_codes` and `verification_events` have no client write policy.**
  That is deliberate and load-bearing — it's what stops a code being burned
  outside the atomic path. Don't add one.
- **Every RPC derives identity from `auth.uid()`.** Never add a
  `p_membership_id` parameter to a `SECURITY DEFINER` function.
- **Free plan pauses after 7 idle days** and needs a manual dashboard resume.
  `.github/workflows/keepalive.yml` prevents it; set `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` as repository secrets.
