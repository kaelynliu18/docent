import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as s from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { readSeed, seedArt } from "@/lib/db/seed";
import { EMBEDDING } from "@/lib/algo/config";
import { nearestArtworks, resetIndexCache } from "@/lib/server/embeddings";

let db: DB;
let ids: string[];
const key = { model: EMBEDDING.model, version: EMBEDDING.version };
/** A 512-d one-hot-ish vector: paintings sharing `axis` look alike. */
const vec = (axis: number, wobble = 0) => Array.from({ length: EMBEDDING.dims }, (_, i) => (i === axis ? 1 : i === axis + 1 ? wobble : 0));

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema: s }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "lib/db/migrations" });
  const ds = readSeed();
  await seedArt(db, ds);
  ids = ds.artworks.filter((a) => a.inPool).slice(0, 6).map((a) => a.id);
  const [a, b, c, d, e, f] = ids;
  await db.insert(s.artworkEmbeddings).values([
    { artworkId: a, kind: "image", ...key, vector: vec(0) },
    { artworkId: b, kind: "image", ...key, vector: vec(0, 0.2) }, // looks like a
    { artworkId: c, kind: "image", ...key, vector: vec(10) },
    { artworkId: d, kind: "image", ...key, vector: vec(0, 0.5) }, // a bit like a
    { artworkId: e, kind: "image", ...key, vector: null, error: "download 404" }, // failed: ignored
    { artworkId: f, kind: "image", model: key.model, version: "old", vector: vec(0) }, // other version: ignored
  ]);
  resetIndexCache();
}, 180_000);

describe("nearestArtworks", () => {
  it("ranks by similarity, never returns the painting itself, failed rows or other model versions", async () => {
    const [a, b, , d, e, f] = ids;
    const near = await nearestArtworks(db, a, 5, { kind: "image" });
    expect(near.map((n) => n.id)).toEqual([b, d, ids[2]]);
    expect(near.map((n) => n.id)).not.toContain(a);
    expect(near.map((n) => n.id)).not.toContain(e);
    expect(near.map((n) => n.id)).not.toContain(f);
    expect(near[0].score).toBeGreaterThan(near[1].score);
  });

  it("returns nothing for a painting without an embedding", async () => {
    expect(await nearestArtworks(db, ids[4], 5)).toEqual([]);
  });
});
