/**
 * pnpm eval:algo — compare predictors on simulated users over the real pool.
 * Reads fixtures/seed.json. Pass TRUTH=artist-only to stress-test.
 */
import { readSeed } from "@/lib/db/seed";
import { BASELINE_WEIGHTS, DEFAULT_TRUTH, PREDICT_WEIGHTS, evaluatePredictors, type EvalItem } from "@/lib/algo/evaluate";

const ds = readSeed();
const artistName = new Map(ds.artists.map((a) => [a.id, a.name]));
const mv = new Map<string, string[]>();
for (const x of ds.artworkMovements) mv.set(x.artworkId, [...(mv.get(x.artworkId) ?? []), x.movementId]);
const gn = new Map<string, string[]>();
for (const x of ds.artworkGenres ?? []) gn.set(x.artworkId, [...(gn.get(x.artworkId) ?? []), x.genreId]);
const items: EvalItem[] = ds.artworks
  .filter((w) => w.inPool)
  .map((w) => ({ id: w.id, artistId: w.artistId, artistName: artistName.get(w.artistId) ?? w.artistId, movementIds: mv.get(w.id) ?? [], genreIds: gn.get(w.id) ?? [], year: w.year }));

const predictors = {
  "spec (artist + movement)": BASELINE_WEIGHTS,
  "new (+ genre + era)": PREDICT_WEIGHTS,
  "genre-heavy": { artist: 1, movement: 0.5, genre: 0.7, period: 0.3, content: 0.6 },
  "artist-only": { artist: 1, movement: 0, genre: 0, period: 0, content: 0 },
};
const truths = {
  default: DEFAULT_TRUTH,
  "artist-driven": { artist: 1, movement: 0.3, genre: 0.1, period: 0.05, noise: 0.5 },
  "subject-driven": { artist: 0.5, movement: 0.4, genre: 1, period: 0.4, noise: 0.5 },
};
console.log(`${items.length} pool paintings, ${new Set(items.map((i) => i.artistId)).size} artists\n`);
for (const [tname, truth] of Object.entries(truths)) {
  console.log(`Simulated users: ${tname}`);
  const res = evaluatePredictors(items, predictors, { users: 300, truth });
  for (const [name, r] of Object.entries(res)) {
    console.log(`  ${name.padEnd(26)} spearman ${r.spearman.toFixed(3)}   top-10 hit ${(r.top10Hit * 100).toFixed(1)}%`);
  }
  console.log();
}
