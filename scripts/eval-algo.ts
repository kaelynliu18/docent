/**
 * pnpm eval:algo — compare predictors on simulated users over the real pool.
 * Reads fixtures/seed.json (colour from `pnpm looks colors --seed`, moods from
 * `pnpm looks moods --seed`). Paintings without real moods get synthetic ones,
 * so the mood machinery can be tested before tagging has run; the output says which.
 */
import { readSeed } from "@/lib/db/seed";
import { BASELINE_WEIGHTS, DEFAULT_TRUTH, PREDICT_WEIGHTS, evaluatePredictors, mulberry32, type EvalItem, type TruthWeights } from "@/lib/algo/evaluate";
import { MOODS, lookTags, type ColorStats } from "@/lib/algo/look";

const ds = readSeed();
const artistName = new Map(ds.artists.map((a) => [a.id, a.name]));
const mv = new Map<string, string[]>();
for (const x of ds.artworkMovements) mv.set(x.artworkId, [...(mv.get(x.artworkId) ?? []), x.movementId]);
const gn = new Map<string, string[]>();
for (const x of ds.artworkGenres ?? []) gn.set(x.artworkId, [...(gn.get(x.artworkId) ?? []), x.genreId]);

const pool = ds.artworks.filter((w) => w.inPool);
const realMoods = pool.filter((w) => w.moods?.length).length;
const rng = mulberry32(7);
const moodIds = Object.keys(MOODS);
const synthetic = () => [...new Set([moodIds[Math.floor(rng() * moodIds.length)], ...(rng() < 0.5 ? [moodIds[Math.floor(rng() * moodIds.length)]] : [])])];
const items: EvalItem[] = pool.map((w) => ({
  id: w.id,
  artistId: w.artistId,
  artistName: artistName.get(w.artistId) ?? w.artistId,
  movementIds: mv.get(w.id) ?? [],
  genreIds: gn.get(w.id) ?? [],
  year: w.year,
  looks: lookTags(w.colors as ColorStats | null | undefined),
  moods: w.moods?.length ? w.moods : synthetic(),
}));

const V2 = { artist: 1, movement: 0.5, genre: 0.35, period: 0.2, content: 0.6 };
const predictors = {
  "spec (artist + movement)": { weights: BASELINE_WEIGHTS, phase: false },
  "v2 (live today)": { weights: V2, phase: false },
  "v3 defaults": PREDICT_WEIGHTS,
  "v3 personal weights": "personal" as const,
};
const truths: Record<string, TruthWeights> = {
  "old world (no colour/mood/phase)": DEFAULT_TRUTH,
  "artist-driven": { artist: 1, movement: 0.3, genre: 0.1, period: 0.05, noise: 0.5 },
  "colour + mood matter": { ...DEFAULT_TRUTH, artist: 0.6, look: 0.6, mood: 0.9 },
  "artists change": { ...DEFAULT_TRUTH, phase: 0.9 },
  "mixed (all of it)": { ...DEFAULT_TRUTH, look: 0.4, mood: 0.6, phase: 0.6 },
};
const withColour = items.filter((i) => i.looks?.length).length;
console.log(`${items.length} pool paintings, ${new Set(items.map((i) => i.artistId)).size} artists`);
console.log(`colour tags on ${withColour}; real moods on ${realMoods} (others synthetic)\n`);
for (const train of [25, 60]) {
  for (const [tname, truth] of Object.entries(truths)) {
    console.log(`${train} rankings · simulated taste: ${tname}`);
    const res = evaluatePredictors(items, predictors, { users: 300, truth, train });
    for (const [name, r] of Object.entries(res)) {
      console.log(`  ${name.padEnd(26)} spearman ${r.spearman.toFixed(3)}   top-10 hit ${(r.top10Hit * 100).toFixed(1)}%`);
    }
    console.log();
  }
}
