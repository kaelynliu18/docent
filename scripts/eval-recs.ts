/**
 * pnpm eval:recs — recommenders on synthetic users (lib/algo/evalRecs.ts),
 * using the real catalogue and its stored CLIP embeddings. Writes the
 * "recs" section of docs/eval-results.md. Needs `pnpm embed` first.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { EMBEDDING, RECS } from "@/lib/algo/config";
import { indexesFromRows } from "@/lib/algo/vectors";
import { evaluateRecommenders, type EvalPainting, type Method, type Truth } from "@/lib/algo/evalRecs";
import { cleanMoods, lookTags } from "@/lib/algo/look";
import { writeEvalSection } from "@/lib/evalReport";

async function main() {
  const db = await getDb();
  const rows = await db
    .select({ id: s.artworkEmbeddings.artworkId, kind: s.artworkEmbeddings.kind, vector: s.artworkEmbeddings.vector })
    .from(s.artworkEmbeddings)
    .where(and(eq(s.artworkEmbeddings.model, EMBEDDING.model), eq(s.artworkEmbeddings.version, EMBEDDING.version), isNotNull(s.artworkEmbeddings.vector)));
  const { image, hybrid } = indexesFromRows(rows.map((r) => ({ ...r, vector: r.vector! })), EMBEDDING.dims, RECS.imageWeight);
  const works = await db
    .select({ id: s.artworks.id, artistId: s.artworks.artistId, artistName: s.artists.name, year: s.artworks.year, fame: s.artworks.fame, colors: s.artworks.colors, moods: s.artworks.moods })
    .from(s.artworks)
    .innerJoin(s.artists, eq(s.artists.id, s.artworks.artistId))
    .where(eq(s.artworks.inPool, true));
  const mv = new Map<string, string[]>();
  for (const r of await db.select().from(s.artworkMovements)) mv.set(r.artworkId, [...(mv.get(r.artworkId) ?? []), r.movementId]);
  const gn = new Map<string, string[]>();
  for (const r of await db.select().from(s.artworkGenres)) gn.set(r.artworkId, [...(gn.get(r.artworkId) ?? []), r.genreId]);
  const items: EvalPainting[] = works.map((w) => ({ ...w, movementIds: mv.get(w.id) ?? [], genreIds: gn.get(w.id) ?? [], looks: lookTags(w.colors), moods: cleanMoods(w.moods) }));
  const withEmb = items.filter((it) => image.pos.has(it.id)).length;

  const truths: Record<string, Truth> = {
    "mixed taste (visual + artist + popularity)": { visual: 1, artist: 0.6, popularity: 0.4, noise: 0.6 },
    "taste isn't visual (artist + popularity only)": { visual: 0, artist: 1, popularity: 0.4, noise: 0.6 },
  };
  const scenarios = [
    { name: "New user: 3 rankings", train: 3 },
    { name: "Warm user: 25 rankings", train: 25 },
  ];
  const order: Method[] = ["random", "popularity", "traits", "content", "hybrid", "hybrid (no MMR)"];
  const label: Record<Method, string> = {
    random: "Random",
    popularity: "Popularity (fame)",
    traits: "Trait model (artist, movement, genre, century, colour, mood)",
    content: "Content: CLIP taste vector",
    hybrid: "Hybrid: CLIP + traits + CF + popularity prior, MMR",
    "hybrid (no MMR)": "Hybrid without MMR",
  };
  let md = `## Recommendations (synthetic users)\n\n**The users are synthetic.** Docent doesn't have enough real users yet. ${items.length} pool paintings (${withEmb} with embeddings). 800 simulated people per row, in 8 taste groups centred on real paintings' CLIP image embeddings; each sees 40 paintings (biased toward famous ones), ranks them, and their top 5 are hidden. Methods recommend from everything they haven't ranked. HR@10 = share of people with at least one hidden favourite in the top 10; NDCG@10 rewards putting them high. The visual taste in the first block is defined in CLIP space, which favours CLIP-based methods by construction; the second block removes it as a control.\n\nCommand: \`pnpm eval:recs\` (model ${EMBEDDING.model} ${EMBEDDING.version}, MMR λ ${RECS.mmrLambda}, blend β ${RECS.embedBlend}, popularity prior ${RECS.popularityCold} cold / ${RECS.popularityWarm} warm). The prior weights were picked on these same synthetic users (a grid over 0–2), whose taste includes some popularity by assumption, so treat the hybrid numbers as optimistic until real users exist.\n`;
  for (const [tname, truth] of Object.entries(truths)) {
    md += `\n### ${tname}\n\n| Method | ${scenarios.map((s) => `${s.name} HR@10 | NDCG@10`).join(" | ")} |\n|---|${scenarios.map(() => "---:|---:").join("|")}|\n`;
    const res = scenarios.map((sc) => evaluateRecommenders(items, image, hybrid, { users: 800, seen: 40, train: sc.train, truth }));
    for (const m of order) md += `| ${label[m]} | ${res.map((r) => `${(r[m].hit * 100).toFixed(1)}% | ${r[m].ndcg.toFixed(3)}`).join(" | ")} |\n`;
    const noPop = scenarios.map((sc) => evaluateRecommenders(items, image, hybrid, { users: 800, seen: 40, train: sc.train, truth, methods: ["hybrid"], recOpts: { popularityCold: 0, popularityWarm: 0 } }));
    md += `| Hybrid without the popularity prior | ${noPop.map((r) => `${(r.hybrid.hit * 100).toFixed(1)}% | ${r.hybrid.ndcg.toFixed(3)}`).join(" | ")} |\n`;
    console.log(tname, JSON.stringify(res.map((r) => Object.fromEntries(order.map((m) => [m, r[m].hit.toFixed(3)])))));
  }
  writeEvalSection("recs", md);
  console.log("wrote docs/eval-results.md");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
