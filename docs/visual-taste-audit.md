# Visual taste: audit (Step 0)

Read-only survey of the repo before building the visual-taste spec (embeddings, recommendations, taste map, photo recognition).

## Stack
- Next.js 15 App Router, TypeScript strict, Tailwind v4, pnpm 12, Node 24.
- Postgres via Drizzle: embedded **PGlite** locally (single process), postgres-js on Vercel (Neon/Supabase). Migrations in `lib/db/migrations`.
- Hosting: Vercel (serverless functions, crons in `vercel.json`); weekly Wikidata ingest also runs as a GitHub Action.
- Tests: Vitest unit (`tests/unit`) and integration on PGlite (`tests/integration`), Playwright e2e (`tests/e2e`). ESLint. CI in `.github/workflows/ci.yml` (Actions currently blocked by a billing lock on the account).
- Rules from `CLAUDE.md`: algorithms are pure functions in `lib/algo/` with tests; data access through `lib/server/data.ts` and `visits.ts`; identity only from the session cookie; scores computed on read, never stored; only `lib/ingest/` calls Wikidata/Commons.

## Data model
- `artworks`: Wikidata Q-id, title, artist, year, Commons `image_file` (URLs are derived, not stored), museum, `in_pool`, `nudity`, `colors` (measured from the image), `moods`, plus `owner_id` for hand-added paintings (private to their owner).
- Catalogue size: **9,153 artworks, all with an image**; 1,580 are in the ranking/recommendation pool, the rest are museum holdings used when identifying photos. 294 museums.
- `visits` (user, museum, day) and `photos` (user, visit, storage key, `artwork_id` once identified). Photos are stored, private, EXIF-stripped, resized in the browser.
- `rankings`: tier (loved/fine/meh) + fractional-index position. `comparisons`: every pairwise answer (winner, loser, tie).
- Scores are **already computed on read**: tier band, then a 50/50 blend of even spacing and a per-user Bradley–Terry fit on `comparisons` (`lib/algo/bradleyTerry.ts`). No new conversion is needed; recommendations read `getRankedList`.

## Existing recommendation / recognition code
- **Recommendations:** content model over Wikidata traits plus colour and mood, era-aware artist term, per-person learned weights (`lib/algo/predict.ts`, `personal.ts`); item–item CF with a self-check, on once 20+ peers overlap (`cf.ts`); template explanations (`explain.ts`); museum matching (`match.ts`). Offline eval harness on simulated users (`evaluate.ts`, `pnpm eval:algo`).
- **Photo identification:** manual. The user picks the painting from the visited museum's catalogue list (`IdentifyDialog`, `identifyCandidates`), or adds it by hand. No image recognition, no embeddings.

## How the spec maps, and conflicts
| Spec | Plan here | Why |
|---|---|---|
| CLIP/SigLIP, open, CPU | **CLIP ViT-B/32** (`Xenova/clip-vit-base-patch32`, q8 ONNX) via `@huggingface/transformers` in Node | Same language as the app, no Python. Benchmarked at 25 ms/image on CPU; picked a distorted Starry Night out of 8 correctly (0.83 vs 0.62). MobileCLIP-S0 was slower here and got it wrong. |
| pgvector if Postgres | **Flat table** (`artwork_embeddings`, `real[]`) + **exact in-memory cosine search**, loaded lazily per server instance | PGlite 0.5 here doesn't bundle pgvector, so a vector column would break local dev and tests. At 9,153 × 512 an exact scan is ~10 ms, inside the 100 ms target; pgvector is a drop-in later if the catalogue grows 10×. |
| `GET /api/recommendations?userId=` | Same route, **user from the session** | `CLAUDE.md`: identity never comes from the request. |
| Ranking → per-user score | Use existing scores | Already a Bradley–Terry blend on stored comparisons. |
| Content + CF hybrid, MMR, reasons | Add an embedding term and candidates to the existing recommender; reuse CF and the explanation templates | Avoids a second, parallel recommender. |
| Cache per user | Per-instance memo keyed by the user's latest ranking time | Serverless instances don't share memory; compute is cheap. |
| Photo recognition server-side | **Embed photos in the browser** (transformers.js, same model), send only the vector; match on the server | A Vercel function can't comfortably hold onnxruntime + an 88 MB model (bundle limit, cold starts). In the browser the photo never leaves the phone for a scan. First use downloads the model once (cached). |
| "Add artwork" scan screen | Suggest matches inside the existing **Identify** step (ranked within the visited museum first), plus a standalone Scan | That's where Docent already turns a photo into a catalogue entry. |
| Background embedding job | `pnpm embed` script; added to the weekly ingest workflow | Never in a request handler. |
| Real-photo eval (30–50 photos) | Script ready; **needs photos you take** of catalogue paintings | I have one real photo, and that painting (Picasso, *Girl with a Mandolin*) isn't in the catalogue. |
| Catalogue coverage | Flag | Wikidata gives only 63 MoMA paintings, for example; recognition can't find what isn't catalogued, so the not-found path matters. |
| Text embedding fields | title, artist, movement, genre, century (no medium/description in our data) | Wikidata fields we ingest. |
| One config file | `lib/algo/config.ts` for the new knobs | Existing knobs stay where their tests expect them. |
