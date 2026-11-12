/** pnpm eval:sessions — score fidelity and questions per painting, Beli-style vs Docent. */
import { readSeed } from "@/lib/db/seed";
import type { EvalItem } from "@/lib/algo/evaluate";
import { blendSpacing, btSpacing, evenSpacing, midpointSpacing, shrunkSpacing, simulateSessions } from "@/lib/algo/simulate";

const ds = readSeed();
const name = new Map(ds.artists.map((a) => [a.id, a.name]));
const mv = new Map<string, string[]>();
for (const x of ds.artworkMovements) mv.set(x.artworkId, [...(mv.get(x.artworkId) ?? []), x.movementId]);
const gn = new Map<string, string[]>();
for (const x of ds.artworkGenres) gn.set(x.artworkId, [...(gn.get(x.artworkId) ?? []), x.genreId]);
const items: EvalItem[] = ds.artworks
  .filter((w) => w.inPool)
  .map((w) => ({ id: w.id, artistId: w.artistId, artistName: name.get(w.artistId) ?? w.artistId, movementIds: mv.get(w.id) ?? [], genreIds: gn.get(w.id) ?? [], year: w.year }));

const users = Number(process.env.USERS ?? 300);
for (const paintings of [15, 30, 60]) {
  const r = simulateSessions(
    items,
    { "Beli (even spacing)": evenSpacing, "Docent v1 (shrunk)": shrunkSpacing, "Midpoint": midpointSpacing, "Bradley-Terry": btSpacing, "BT/v1 blend": blendSpacing },
    ["bisect", "guess-first", "gallop", "nudge"],
    { users, paintings, compareNoise: Number(process.env.CMP_NOISE ?? 0.35), tierNoise: Number(process.env.TIER_NOISE ?? 0.8) },
  );
  console.log(`\n${paintings} paintings per person, ${users} people`);
  for (const [k, v] of Object.entries(r.fidelity)) {
    console.log(`  ${k.padEnd(22)} MAE ${v.mae.toFixed(3)}  pearson ${v.pearson.toFixed(3)}  spearman ${v.spearman.toFixed(3)}`);
  }
  for (const [k, v] of Object.entries(r.questionsPerPainting)) console.log(`  questions/painting ${k.padEnd(12)} ${v.toFixed(3)}`);
}
