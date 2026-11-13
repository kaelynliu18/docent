# Visual taste: embeddings, recommendations, taste map, photo recognition

Docent's rankings now power three things that work *because* art is visual: recommendations from a visual embedding space (including for brand-new users), an interactive taste map, and photo-to-artwork recognition. Numbers are in [eval-results.md](eval-results.md); the pre-build audit is in [visual-taste-audit.md](visual-taste-audit.md).

## Architecture

```
Commons thumbnails ──pnpm embed──▶ artwork_embeddings (image + text, per model version)
                                        │
                     ┌──────────────────┼────────────────────────┐
                     ▼                  ▼                        ▼
         in-memory exact index    pnpm taste-map           /api/scan (vector in)
         (lib/server/embeddings)  UMAP + k-means           ▲
                     │            → artwork_map            │ browser: same CLIP model,
                     ▼              map_clusters           │ photo never uploaded
     getRecommendations ◀── rankings (tier + Bradley–Terry scores, computed on read)
     /api/recommendations, /recommendations, /taste/map, Identify "From your photo", /scan
```

- **Model:** open CLIP ViT-B/32 (`Xenova/clip-vit-base-patch32`, 8-bit ONNX) via transformers.js. Same TypeScript stack, no paid API, 25 ms per image on a laptop CPU. MobileCLIP-S0 was tried and rejected (slower here, and it picked the wrong painting in a spot check).
- **Storage:** a flat `real[]` table keyed by artwork + kind + model + version, not pgvector. Local dev runs embedded PGlite, which doesn't ship pgvector; an exact scan of 9,153 × 1,024 dims takes ~9 ms, well inside the 100 ms target. pgvector is a drop-in if the catalogue grows 10×.
- **Hybrid similarity in one index:** image and text vectors are concatenated with weights √0.7 and √0.3, so one dot product equals 0.7·cos(image) + 0.3·cos(text).
- **Heavy work never runs in a request:** `pnpm embed`, `pnpm taste-map` and the evals are scripts. The backfill is idempotent and resumable (a second run reports "nothing to do"), rate-limits Commons, times out hung downloads and records failures. Changing `EMBEDDING.version` re-embeds cleanly.
- **One config file:** `lib/algo/config.ts` (model, k, MMR λ, blend weights, popularity prior, map seed and clusters, scan crop, museum threshold and not-found margin).

## Recommendations

Scores already exist: each ranking's score is its tier band plus a per-user Bradley–Terry fit on stored pairwise comparisons, computed on read. The recommender (`lib/algo/recommend.ts`) uses them as follows:

1. **Taste vector:** weighted mean of ranked paintings' embeddings, weight (score − 5)/5, so a 10 pulls toward a painting and a 0 pushes away.
2. **Cold start (≤ 5 rankings):** z(cosine to the taste vector) + 1.0 × z(popularity).
3. **Warm:** ½ z(cosine) + ½ z(trait model, already blended with item–item CF when 20+ peers overlap) + 0.5 × z(popularity), scored on the 400 visually closest candidates.
4. **MMR** (λ 0.75) over the top 200, so results aren't near-copies.
5. **Reason:** the ranked painting with the largest weight × similarity ("Looks like your #2, Water Lilies").

`GET /api/recommendations` takes the user from the session (the spec's `?userId=` would let anyone read anyone's taste). Results are cached per user and invalidated when their ranking count or latest change moves.

**Evaluation (synthetic users; there aren't enough real ones).** 800 simulated people per row, in 8 taste groups centred on real paintings' embeddings. Each sees 40 paintings (biased toward famous ones), ranks them, and their top 5 are hidden.

| HR@10, mixed taste | 3 rankings | 25 rankings |
|---|---:|---:|
| Random | 3.0% | 4.0% |
| Popularity | 6.4% | 6.4% |
| Trait model | 3.6% | 7.2% |
| CLIP content only | 4.3% | 8.4% |
| **Hybrid** | **11.5%** | **16.3%** |

A new user with 3 rankings beats popularity. Two caveats:
- **The popularity prior does most of the cold-start work.** Without it the hybrid drops to 3.8%.
- **It was tuned on the same synthetic users,** whose taste includes some popularity by assumption.

In a control where taste isn't visual at all, the hybrid ties popularity for new users (8.3% vs 8.4%) and wins once warm (10.1% vs 8.8%). Real users are the next test.

## Taste map

`pnpm taste-map` runs seeded UMAP over all 9,153 image embeddings (about 7 s), spherical k-means into 14 clusters, and labels each cluster from the most common movement, genre and century of its members (e.g. *Dutch Golden Age painting, 17th century*, *Expressionism, 20th century*). The coordinates are stored, so `/taste/map` just draws them on a canvas:
- the whole catalogue as faint dots, your rankings sized by score and coloured by tier;
- hover for title, artist and rank; click to open the painting; pan, zoom and pinch;
- dashed rings and links for **unexplored regions**: clusters holding ≥ 3% of the catalogue where you've ranked nothing, each linking to recommendations from that region.

## Photo recognition

The photo is embedded **in the browser** with the same CLIP model, and only the 512 numbers go to `/api/scan`. A Vercel function can't comfortably hold the model, and this way the photo never leaves the phone. The model downloads once (~90 MB, cached). Matching searches the visited museum's paintings first, then the whole catalogue, and always shows the top 5 to confirm, because series and near-copies make one automatic answer unreliable. It lives in the Identify step ("From your photo") and on a standalone `/scan` page with a text-search fallback.

**Synthetic eval** (150 catalogue paintings, 7 distortions):
- A realistic phone shot (frame, wall, tilt, dim light, glare) is found **top-1 85% / top-5 96%** across the whole catalogue with the centre crop, and **97% / 99%** within the visited museum.
- The centre crop was the single biggest win: without it, the realistic case drops to 52% top-1. It's now on by default.
- It hurts already-tight or blurry shots (blur: 95% → 66%), so a rectangle detector is the obvious next step.
- **Speed:** 19 ms per query (embed + search) on CPU.
- Local-feature re-ranking wasn't attempted.

**"Not found" is the weak spot.** CLIP finds most paintings fairly similar to each other, so a high top score doesn't mean "it's in the catalogue" (71% balanced accuracy at best). Whether the best match stands clearly ahead of the runner-up separates the cases better (80%), so the app flags "not a confident match" when that gap is under 0.016. It still shows the closest five, and offers text search or adding the painting by hand.

On the synthetic set, that rule shows 77% of catalogued paintings as found and flags 84% of missing ones.

**Real photos: pending.** The one real photo so far (Picasso, *Girl with a Mandolin*) isn't in the catalogue. Its top score was a high 0.79, but its gap was only 0.012, so it's correctly flagged "not a confident match". Put 30–50 photos of catalogue paintings in `eval/photos/<Wikidata id>.jpg` and run `pnpm eval:scan` for the headline number.

## Limits and next steps

- **Catalogue coverage** bounds recognition: Wikidata lists only 63 MoMA paintings, for example.
- **Collaborative filtering** has been tested only on synthetic populations.
- **Recognition:** rectangle detection and a sharper not-found signal (e.g. comparing against that museum's score distribution).
- **Embedding new artworks:** `pnpm embed` should run after the weekly ingest. The GitHub Action that would run it is blocked by an account billing lock.

Run everything: `pnpm embed && pnpm taste-map && pnpm eval:recs && pnpm eval:scan && pnpm spot-check` (stop `pnpm dev`/`start` first locally).
