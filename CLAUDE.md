# Docent
Beli-style art ranking + museum recommender (formerly "Salon" in the spec).
Spec: docs/spec.md. Deviations from the spec: docs/decisions.md.

## Rules
- Algorithms live in lib/algo/ as pure functions with tests. Never put scoring math in components or routes.
- Never call Wikidata from a user-facing request. Only lib/ingest/ talks to Wikidata.
- Use fixtures in fixtures/wikidata/ for tests; tests must not hit the network (e2e loads Commons images, that's the one exception).
- Scores are computed on read; never store them.
- User identity comes from the signed session cookie (lib/server/session.ts), never from request bodies.
- Data access goes through lib/server/data.ts (rankings, taste, museums) and lib/server/visits.ts (visits, photos,
  identification), which take `db` and `userId` as arguments so they're testable.
- Visits only: a painting can be ranked only if the user has a photo of it from a visit (enforced in insertRanking).
- Photos are private to their owner. Hand-added paintings (`artworks.owner_id` set, id `X…`) must never leak to
  other users or into recommendations.
- Settings come from `env()` in lib/env.ts, never `process.env` directly in new code.
- Photo bytes go through lib/server/storage.ts (local or S3); never write to disk elsewhere.
- Phones get the bottom TabBar (md:hidden); fixed bottom UI must sit above it: `bottom-[calc(env(safe-area-inset-bottom)+4rem)] md:bottom-0`.
- Run `pnpm test` and `pnpm typecheck` before saying a task is done.

## Local dev
- No DATABASE_URL → embedded PGlite in .data/pglite (auto-migrates). Only one process can open it:
  stop `pnpm dev` before `pnpm db:seed` or `pnpm ingest`.
- `pnpm db:seed` loads fixtures/seed.json and recreates the demo account.
- Schema change: edit lib/db/schema.ts, then `pnpm db:generate` (rename the file to something descriptive), then `pnpm db:migrate`.
- The service worker registers only in production builds; test PWA behaviour with `pnpm build && pnpm start`.
- Fractional-index `position` keys must be compared bytewise (see `byPosition` in data.ts), not with DB collation.

## Stack
Next.js 15 (App Router), TypeScript strict, Tailwind v4, Drizzle + Postgres (PGlite locally, Supabase/Neon in prod),
TanStack Query, Leaflet + OSM tiles, Vitest, Playwright.
