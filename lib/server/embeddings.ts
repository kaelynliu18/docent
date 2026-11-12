import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { EMBEDDING, RECS } from "@/lib/algo/config";
import { indexesFromRows, topK, vectorOf, type VectorIndex } from "@/lib/algo/vectors";

/**
 * The catalogue's embeddings, packed into an in-memory index once per server
 * instance and refreshed every few minutes. Exact cosine search: at ~9k
 * paintings a full scan is ~10 ms, so no approximate index is needed.
 */
export type Indexes = { image: VectorIndex; hybrid: VectorIndex };
const TTL_MS = 10 * 60_000;
let cached: { at: number; db: DB; value: Promise<Indexes> } | null = null;

export function loadIndexes(db: DB): Promise<Indexes> {
  if (cached && cached.db === db && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = (async () => {
    const rows = await db
      .select({ id: s.artworkEmbeddings.artworkId, kind: s.artworkEmbeddings.kind, vector: s.artworkEmbeddings.vector })
      .from(s.artworkEmbeddings)
      .where(
        and(
          eq(s.artworkEmbeddings.model, EMBEDDING.model),
          eq(s.artworkEmbeddings.version, EMBEDDING.version),
          isNotNull(s.artworkEmbeddings.vector),
        ),
      );
    return indexesFromRows(
      rows.map((r) => ({ id: r.id, kind: r.kind, vector: r.vector! })),
      EMBEDDING.dims,
      RECS.imageWeight,
    );
  })();
  cached = { at: Date.now(), db, value };
  value.catch(() => (cached = null));
  return value;
}

/** For tests and after a backfill. */
export function resetIndexCache() {
  cached = null;
}

/** Top-k paintings that look (and read) most like `artworkId`, hybrid similarity by default. */
export async function nearestArtworks(
  db: DB,
  artworkId: string,
  k = 10,
  opts: { kind?: "image" | "hybrid"; keep?: (id: string) => boolean } = {},
): Promise<{ id: string; score: number }[]> {
  const ix = (await loadIndexes(db))[opts.kind ?? "hybrid"];
  const q = vectorOf(ix, artworkId);
  if (!q) return [];
  return topK(ix, q, k, { exclude: new Set([artworkId]), keep: opts.keep });
}
