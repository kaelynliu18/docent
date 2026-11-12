/**
 * pnpm taste-map — precomputes the taste map for the whole catalogue:
 * UMAP of the CLIP image embeddings to 2D (fixed seed, so the layout is stable
 * across runs), spherical k-means clusters on the full embeddings, and an
 * automatic label per cluster from catalogue metadata. Writes artwork_map and
 * map_clusters for the current embedding version. Needs `pnpm embed` first.
 * Locally, stop the app while it runs (PGlite allows one process).
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { UMAP } from "umap-js";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { EMBEDDING, MAP, mapVersion } from "@/lib/algo/config";
import { normalize } from "@/lib/algo/vectors";
import { kmeans, labelClusters } from "@/lib/algo/cluster";
import { mulberry32 } from "@/lib/algo/evaluate";
import { periodOf } from "@/lib/algo/taste";

async function main() {
  const db = await getDb();
  const rows = await db
    .select({ id: s.artworkEmbeddings.artworkId, vector: s.artworkEmbeddings.vector })
    .from(s.artworkEmbeddings)
    .where(
      and(
        eq(s.artworkEmbeddings.kind, "image"),
        eq(s.artworkEmbeddings.model, EMBEDDING.model),
        eq(s.artworkEmbeddings.version, EMBEDDING.version),
        isNotNull(s.artworkEmbeddings.vector),
      ),
    );
  if (rows.length < 50) throw new Error(`only ${rows.length} image embeddings; run pnpm embed first`);
  const vecs = rows.map((r) => normalize(r.vector!));
  console.log(`UMAP on ${vecs.length} paintings…`);
  const t0 = Date.now();
  const umap = new UMAP({ nComponents: 2, nNeighbors: MAP.neighbors, minDist: MAP.minDist, random: mulberry32(MAP.seed) });
  const xy = umap.fit(vecs.map((v) => Array.from(v)));
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  // Scale to 0–1 so the client doesn't care about UMAP's units.
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const coords = xy.map(([x, y]) => [(x - x0) / (x1 - x0 || 1), (y - y0) / (y1 - y0 || 1)] as const);

  const { assign } = kmeans(vecs, MAP.clusters, mulberry32(MAP.seed));

  // Labels from metadata.
  const meta = await db
    .select({ id: s.artworks.id, year: s.artworks.year })
    .from(s.artworks);
  const year = new Map(meta.map((m) => [m.id, m.year]));
  const mv = new Map<string, string[]>();
  for (const r of await db
    .select({ a: s.artworkMovements.artworkId, name: s.movements.name })
    .from(s.artworkMovements)
    .innerJoin(s.movements, eq(s.movements.id, s.artworkMovements.movementId)))
    mv.set(r.a, [...(mv.get(r.a) ?? []), r.name]);
  const gn = new Map<string, string[]>();
  for (const r of await db
    .select({ a: s.artworkGenres.artworkId, name: s.genres.name })
    .from(s.artworkGenres)
    .innerJoin(s.genres, eq(s.genres.id, s.artworkGenres.genreId)))
    gn.set(r.a, [...(gn.get(r.a) ?? []), r.name]);
  const k = Math.max(...assign) + 1;
  const members = Array.from({ length: k }, () => [] as { movements: string[]; genres: string[]; century: string | null }[]);
  rows.forEach((r, i) => members[assign[i]].push({ movements: mv.get(r.id) ?? [], genres: gn.get(r.id) ?? [], century: periodOf(year.get(r.id))?.name ?? null }));
  const labels = labelClusters(members);

  // Label position: the median point of the cluster (robust to stragglers).
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0.5;
  const clusters = labels.map((label, c) => {
    const pts = coords.filter((_, i) => assign[i] === c);
    return { cluster: c, label, x: median(pts.map((p) => p[0])), y: median(pts.map((p) => p[1])), size: pts.length };
  });

  const version = mapVersion();
  await db.transaction(async (tx) => {
    await tx.delete(s.artworkMap).where(eq(s.artworkMap.version, version));
    await tx.delete(s.mapClusters).where(eq(s.mapClusters.version, version));
    const values = rows.map((r, i) => ({ artworkId: r.id, version, x: coords[i][0], y: coords[i][1], cluster: assign[i] }));
    for (let i = 0; i < values.length; i += 1000) await tx.insert(s.artworkMap).values(values.slice(i, i + 1000));
    await tx.insert(s.mapClusters).values(clusters.map((c) => ({ ...c, version })));
  });
  for (const c of [...clusters].sort((a, b) => b.size - a.size)) console.log(`  ${String(c.size).padStart(5)}  ${c.label}`);
  console.log(`wrote ${rows.length} points, ${clusters.length} clusters (${version})`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
