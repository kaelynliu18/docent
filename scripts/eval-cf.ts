/** pnpm eval:cf — does collaborative filtering help as the user base grows? */
import { readSeed } from "@/lib/db/seed";
import { evaluateCf, type EvalItem } from "@/lib/algo/evaluate";
import { CF_DEFAULTS, blendWithCf, buildCfIndex, cfPredict, fitCfWeight, looCfPoints, type CfIndex } from "@/lib/algo/cf";

const ds = readSeed();
const name = new Map(ds.artists.map((a) => [a.id, a.name]));
const mv = new Map<string, string[]>();
for (const x of ds.artworkMovements) mv.set(x.artworkId, [...(mv.get(x.artworkId) ?? []), x.movementId]);
const gn = new Map<string, string[]>();
for (const x of ds.artworkGenres) gn.set(x.artworkId, [...(gn.get(x.artworkId) ?? []), x.genreId]);
const items: (EvalItem & { fame: number })[] = ds.artworks
  .filter((w) => w.inPool)
  .map((w) => ({ id: w.id, artistId: w.artistId, artistName: name.get(w.artistId) ?? w.artistId, movementIds: mv.get(w.id) ?? [], genreIds: gn.get(w.id) ?? [], year: w.year, fame: w.fame ?? 0 }));

const cfOpts = {
  ...CF_DEFAULTS,
  shrink: Number(process.env.SHRINK ?? CF_DEFAULTS.shrink),
  evidenceHalf: Number(process.env.HALF ?? CF_DEFAULTS.evidenceHalf),
};
const train = Number(process.env.TRAIN ?? 25);
const sizes = (process.env.SIZES ?? "10,100,1000").split(",").map(Number);
for (const shared of (process.env.SHAREDS ?? "1,0").split(",").map(Number)) {
  console.log(`\nShared group taste weight ${shared}${shared === 0 ? " (no hidden group taste: CF should not hurt)" : ""}`);
  for (const population of sizes) {
    let idx: CfIndex | null = null;
    const base = { population, shared, train, evalUsers: Number(process.env.EVAL_USERS ?? 100) };
    const fixed = evaluateCf(
      items,
      base,
      (content, cf) => blendWithCf(content, cf, cfOpts).score,
      (mine, target) => cfPredict(idx!, mine, target, cfOpts),
      (ratings) => (idx = buildCfIndex(ratings)),
    );
    const stacked = evaluateCf(
      items,
      base,
      // Per-person weight caps the evidence-based blend.
      (content, cf, w) => (cf ? content + Math.min(w ?? 0, blendWithCf(content, cf, cfOpts).cfWeight) * (5 + 5 * cf.signed - content) : content),
      (mine, target) => cfPredict(idx!, mine, target, cfOpts),
      (ratings) => (idx = buildCfIndex(ratings)),
      (mine, contentLoo, self) => fitCfWeight(looCfPoints(idx!, mine, contentLoo, cfOpts, self)),
    );
    console.log(
      `  ${String(population).padStart(5)} people: content ${fixed.content.toFixed(3)}  +CF fixed ${fixed.blended.toFixed(3)}  +CF self-checking ${stacked.blended.toFixed(3)}  (neighbours for ${(fixed.coverage * 100).toFixed(0)}%)`,
    );
  }
}
