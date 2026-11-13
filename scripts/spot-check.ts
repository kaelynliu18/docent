/**
 * pnpm spot-check — nearest neighbours of a few well-known paintings, with
 * thumbnails, written to the "neighbours" section of docs/eval-results.md as
 * visual evidence that the embedding space is sensible. Also times the
 * nearest-neighbour call. Needs `pnpm embed` first.
 */
import { and, eq, ilike, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { EMBEDDING, RECS } from "@/lib/algo/config";
import { indexesFromRows, topK, vectorOf } from "@/lib/algo/vectors";
import { commonsImage } from "@/lib/images";
import { writeEvalSection } from "@/lib/evalReport";

const PICKS = ["Impression, Sunrise", "Laughing Cavalier", "Girl with a Pearl Earring", "Suprematist Composition: White on White", "Broadway Boogie Woogie", "The Great Wave off Kanagawa"];

async function main() {
  const db = await getDb();
  const rows = await db
    .select({ id: s.artworkEmbeddings.artworkId, kind: s.artworkEmbeddings.kind, vector: s.artworkEmbeddings.vector })
    .from(s.artworkEmbeddings)
    .where(and(eq(s.artworkEmbeddings.model, EMBEDDING.model), eq(s.artworkEmbeddings.version, EMBEDDING.version), isNotNull(s.artworkEmbeddings.vector)));
  const { hybrid } = indexesFromRows(rows.map((r) => ({ ...r, vector: r.vector! })), EMBEDDING.dims, RECS.imageWeight);
  const meta = new Map(
    (
      await db
        .select({ id: s.artworks.id, title: s.artworks.title, imageFile: s.artworks.imageFile, artist: s.artists.name })
        .from(s.artworks)
        .innerJoin(s.artists, eq(s.artists.id, s.artworks.artistId))
    ).map((m) => [m.id, m]),
  );
  let md = `## Nearest neighbours (spot check)\n\nHybrid similarity (${RECS.imageWeight} image + ${(1 - RECS.imageWeight).toFixed(1)} text), ${hybrid.ids.length} paintings. There's no Rothko in the catalogue, so Malevich and Mondrian stand in for abstraction. Command: \`pnpm spot-check\`.\n`;
  const times: number[] = [];
  for (const title of PICKS) {
    const [w] = await db.select({ id: s.artworks.id }).from(s.artworks).where(ilike(s.artworks.title, title)).limit(1);
    const q = w && vectorOf(hybrid, w.id);
    if (!q) continue;
    const t0 = performance.now();
    const near = topK(hybrid, q, 6, { exclude: new Set([w.id]) });
    times.push(performance.now() - t0);
    const m = meta.get(w.id)!;
    md += `\n### ${m.title} (${m.artist})\n\n<img src="${commonsImage(m.imageFile, 160)}" height="110" alt="${m.title}">  →  ${near
      .map((n) => {
        const x = meta.get(n.id)!;
        return `<img src="${commonsImage(x.imageFile, 160)}" height="110" alt="${x.title}" title="${x.title} (${x.artist}) ${n.score.toFixed(2)}">`;
      })
      .join(" ")}\n\n${near.map((n) => `${meta.get(n.id)!.title} (${meta.get(n.id)!.artist}) ${n.score.toFixed(2)}`).join(" · ")}\n`;
  }
  times.sort((a, b) => a - b);
  md += `\n**Speed:** nearestArtworks over ${hybrid.ids.length} paintings × ${hybrid.dims} dims: median ${times[Math.floor(times.length / 2)].toFixed(1)} ms, worst ${times[times.length - 1].toFixed(1)} ms (target < 100 ms).\n`;
  writeEvalSection("neighbours", md);
  console.log(md.replace(/<img[^>]*>/g, "").slice(0, 3000));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
