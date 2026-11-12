# Docent

Like Beli, for museums: log a visit, upload the photos you took, say which painting each one shows,
and rank them head to head. Docent learns your taste from what you actually saw and recommends museums
that explain themselves ("Holds 23 by Vincent van Gogh, 89 by Claude Monet…"). Art and museum data comes from Wikidata.

## Run it locally

```bash
pnpm install
pnpm db:seed        # embedded Postgres in .data/pglite + 1,580 paintings, 294 museums, demo account
pnpm dev            # http://localhost:3000
```

Try `/login` → "Continue with the demo account": 20 past visits behind 25 rankings (leaning Impressionist), plus a
visit last week with 3 paintings still to rank. Uploaded photos are stored in `.data/photos` (`PHOTO_DIR`).

Keyboard on `/rank`: `1` `2` `3` tiers, `S` skip, `←` `→` pick, `T` too close to call, `Esc` change tier.

## Checks

```bash
pnpm test           # unit (algorithms, parsers) + integration (rankings API against PGlite)
pnpm typecheck
pnpm lint
pnpm build && pnpm test:e2e   # Playwright, desktop + mobile; needs network for Commons images
pnpm eval:algo      # compare predictors on simulated users over the real pool
```

## Data

- `pnpm seed:build` regenerates `fixtures/seed.json` from live Wikidata (a famous slice for dev and demos).
- `pnpm ingest` runs the full ingestion into whatever database is configured: pool (≥8 Wikipedia languages,
  ~2,400 paintings; `POOL_MIN_SITELINKS` to tune), artists, holdings, named works, details (movements, genres),
  fame (Wikipedia pageviews), museums. Takes roughly 20–30 minutes; set `INGEST_USER_AGENT` with a contact.
- Nightly: `.github/workflows/ingest.yml` (set `DATABASE_URL` and `INGEST_USER_AGENT` secrets) or Vercel Cron → `/api/cron/ingest` with `CRON_SECRET`.

## Install it on a phone

Docent is a Progressive Web App. Open the site on your phone, then:
- **iPhone (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** the in-app "Install" prompt, or ⋮ → Install app.

It opens full screen with a bottom tab bar. The **+** tab opens your photo library. Docent reads each photo's date and
location (in the browser, before upload strips them), groups photos into visits and suggests the museum. Uploads
queue on the phone and retry when signal returns. Notifications ("12 paintings to rank from yesterday's visit")
work on Android, and on iPhone once installed (iOS 16.4+).

Note: iOS often strips location from photos picked in Safari. When a photo has no location but was taken today,
Docent uses your current location instead; otherwise it asks which museum.

## Deploy (free tiers, ~20 minutes)

| Piece | Free option | Setting |
|---|---|---|
| App | Vercel Hobby | (connect the repo) |
| Database | Neon or Supabase | `DATABASE_URL` (pooled URL) |
| Photos | Cloudflare R2 (10 GB, no egress fees) or Supabase Storage | `STORAGE_DRIVER=s3`, `S3_*` |
| Email codes | Resend (3,000/month) | `RESEND_API_KEY`, `EMAIL_FROM` |
| Google sign-in | Google Cloud OAuth client | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Notifications | VAPID keys (`pnpm vapid`) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |

1. Create the database; copy its **pooled** connection string.
2. Create a private bucket (R2: *R2 → Create bucket*, then *Manage API tokens* for an access key with read/write on it).
3. On Vercel, set `AUTH_SECRET`, `CRON_SECRET`, `APP_URL` and the rows above. See `.env.example`.
4. Load the art data once from your machine: `DATABASE_URL=… pnpm db:seed` (or `pnpm ingest` for the full ~2,400-painting pool).
5. Deploy. `vercel-build` runs `pnpm db:migrate` first, so schema changes apply on every deploy.

The app refuses to start in production if a required setting is missing (and says which). `/api/health` returns 200
when the database answers; point an uptime monitor at it.

**Scheduled jobs** (`vercel.json`): `/api/cron/daily` sends visit reminders, resets the shared demo account, and
prunes idle guests and expired codes. `/api/cron/ingest` refreshes Wikidata weekly; the full run takes 20–30 minutes,
longer than Vercel allows, so the GitHub Actions workflow (`.github/workflows/ingest.yml`) is the real refresher.

**Self-hosting on one server** (a VPS, Fly.io, Railway): leave `DATABASE_URL` and `STORAGE_DRIVER` unset to keep
everything (PGlite database and photos) under `.data/` on a persistent volume, then `pnpm build && pnpm start`.
Run `/api/cron/daily` once a day with `curl -H "Authorization: Bearer $CRON_SECRET"`.

**Accounts and privacy:** guests can use everything; signing in (email code or Google) keeps their data and works across
devices. Photos are private, served only to their owner, and stripped of GPS/EXIF before upload.
*Account → Delete account* removes everything, which app stores require. The demo account (for the owner's own
demos) works like any account, uploads included; `pnpm db:seed` resets it.

## Layout

```
app/            pages and /api route handlers
lib/algo/       insertion, scoring, taste, prediction, matching, queue (pure, tested)
lib/ingest/     SPARQL queries, parsers, normalization, writer (the only Wikidata client)
lib/db/         Drizzle schema, migrations, seed
lib/server/     session, auth (email codes, Google), data access (data.ts, visits.ts), photo storage (local/S3),
                push reminders, rate limits, maintenance
lib/client/     upload queue (IndexedDB), photo resizing, client stores
public/sw.js    service worker: offline page, asset/image cache, notifications
components/     WallLabel, ScoreBadge, MuseumMap, nav
fixtures/       seed.json and saved Wikidata responses for tests
tests/          unit, integration, e2e
```

See `docs/decisions.md` for where this differs from the original spec.
