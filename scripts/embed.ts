/**
 * pnpm embed [--retry-failed] [--limit N]
 *
 * Backfills CLIP embeddings (lib/algo/config.ts EMBEDDING) for every catalogue
 * painting with an image: an image embedding from a Commons thumbnail and a
 * text embedding from title, artist, movement, genre and century.
 *
 * Idempotent and resumable: rows are keyed by artwork + kind + model + version
 * and written one painting at a time, so a second run (or a run after a crash)
 * only does what's missing. Broken images are recorded with their error and
 * skipped next time unless --retry-failed. Downloads are rate-limited (Commons
 * throttles bursts) and run with EMBEDDING.concurrency in flight.
 *
 * Locally the database is PGlite, which only one process can open: stop the
 * app (pnpm start / dev) while this runs.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { EMBEDDING } from "@/lib/algo/config";
import { artworkText, embedImageBytes, embedTexts } from "@/lib/ingest/embed";
import { politeFetch, pool, thumbUrls } from "@/lib/ingest/looks";

const retryFailed = process.argv.includes("--retry-failed");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;
const key = { model: EMBEDDING.model, version: EMBEDDING.version };

async function main() {
  const db = await getDb();
  const all = await db
    .select({ id: s.artworks.id, title: s.artworks.title, year: s.artworks.year, imageFile: s.artworks.imageFile, artistName: s.artists.name })
    .from(s.artworks)
    .innerJoin(s.artists, eq(s.artists.id, s.artworks.artistId))
    // Hand-added paintings are private to their owner: never embedded into the shared index.
    .where(and(isNotNull(s.artworks.imageFile), isNull(s.artworks.ownerId)));

  const existing = await db
    .select({ id: s.artworkEmbeddings.artworkId, kind: s.artworkEmbeddings.kind, ok: sql<boolean>`${s.artworkEmbeddings.vector} is not null` })
    .from(s.artworkEmbeddings)
    .where(and(eq(s.artworkEmbeddings.model, key.model), eq(s.artworkEmbeddings.version, key.version)));
  console.log(`catalogue: ${all.length} paintings with images; ${existing.length} embedding rows exist`);
  const done = new Set(existing.filter((e) => e.ok || !retryFailed).map((e) => `${e.kind}:${e.id}`));

  // ── Text embeddings: no network, fast. ──
  const needText = all.filter((a) => !done.has(`text:${a.id}`)).slice(0, limit);
  if (needText.length) {
    const ids = needText.map((a) => a.id);
    const mv = new Map<string, string[]>();
    for (const r of await db
      .select({ a: s.artworkMovements.artworkId, name: s.movements.name })
      .from(s.artworkMovements)
      .innerJoin(s.movements, eq(s.movements.id, s.artworkMovements.movementId))
      .where(inArray(s.artworkMovements.artworkId, ids)))
      mv.set(r.a, [...(mv.get(r.a) ?? []), r.name]);
    const gn = new Map<string, string[]>();
    for (const r of await db
      .select({ a: s.artworkGenres.artworkId, name: s.genres.name })
      .from(s.artworkGenres)
      .innerJoin(s.genres, eq(s.genres.id, s.artworkGenres.genreId))
      .where(inArray(s.artworkGenres.artworkId, ids)))
      gn.set(r.a, [...(gn.get(r.a) ?? []), r.name]);
    console.log(`text: ${needText.length} to embed`);
    const texts = needText.map((a) => artworkText({ ...a, movements: mv.get(a.id) ?? [], genres: gn.get(a.id) ?? [] }));
    for (let i = 0; i < needText.length; i += 256) {
      const vecs = await embedTexts(texts.slice(i, i + 256));
      if (i % 2048 === 0) console.log(`text: ${i}/${needText.length}`);
      await db
        .insert(s.artworkEmbeddings)
        .values(needText.slice(i, i + 256).map((a, j) => ({ artworkId: a.id, kind: "text", ...key, vector: [...vecs[j]], error: null })))
        .onConflictDoUpdate({
          target: [s.artworkEmbeddings.artworkId, s.artworkEmbeddings.kind, s.artworkEmbeddings.model, s.artworkEmbeddings.version],
          set: { vector: sql`excluded.vector`, error: null },
        });
    }
    console.log(`text: embedded ${needText.length}`);
  } else console.log("text: nothing to do");

  // ── Image embeddings: download a standard thumbnail, embed, save. ──
  const needImage = all.filter((a) => !done.has(`image:${a.id}`)).slice(0, limit);
  if (!needImage.length) {
    console.log("image: nothing to do");
    return;
  }
  console.log(`image: ${needImage.length} to embed`);
  let ok = 0, failed = 0, n = 0;
  const save = (artworkId: string, vector: number[] | null, error: string | null) =>
    db
      .insert(s.artworkEmbeddings)
      .values({ artworkId, kind: "image", ...key, vector, error })
      .onConflictDoUpdate({
        target: [s.artworkEmbeddings.artworkId, s.artworkEmbeddings.kind, s.artworkEmbeddings.model, s.artworkEmbeddings.version],
        set: { vector: sql`excluded.vector`, error: sql`excluded.error` },
      });
  // Thumbnail links in chunks of 500 as we go, so one slow API call can't hold up everything.
  for (let start = 0; start < needImage.length; start += 500) {
    const chunk = needImage.slice(start, start + 500);
    const thumbs = await thumbUrls(chunk.map((a) => a.imageFile!), EMBEDDING.thumbWidth);
    await pool(chunk, EMBEDDING.concurrency, async (a) => {
      const url = thumbs.get(a.imageFile!);
      try {
        if (!url) throw new Error("no thumbnail");
        const res = await politeFetch(url);
        if (!res?.ok) throw new Error(`download ${res?.status ?? "failed"}`);
        const v = await embedImageBytes(new Uint8Array(await res.arrayBuffer()));
        await save(a.id, [...v], null);
        ok++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`  ${a.id} ${a.title}: ${msg}`);
        await save(a.id, null, msg.slice(0, 200));
      }
      if (++n % 100 === 0) console.log(`image: ${n}/${needImage.length} (${failed} failed)`);
    });
  }
  console.log(`image: ${ok} embedded, ${failed} failed (re-run with --retry-failed to try those again)`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
