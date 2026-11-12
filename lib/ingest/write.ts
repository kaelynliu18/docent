import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { DB } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { Dataset } from "./types";

function chunks<T>(xs: T[], n = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

async function upsert<T extends Record<string, unknown>>(
  tx: Tx,
  table: PgTable,
  rows: T[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  target: any,
  setCols: string[],
) {
  for (const c of chunks(rows)) {
    if (!c.length) continue;
    const set = Object.fromEntries(setCols.map((col) => [col, sql.raw(`excluded."${toSnake(col)}"`)]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx.insert(table).values(c as any) as any).onConflictDoUpdate({ target, set });
  }
}

const toSnake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/**
 * Idempotent write of a full dataset in one transaction. A failure rolls back,
 * so the previous data stays live. Artworks/museums that disappear are kept
 * (user rankings reference them) but drop out of the pool and holdings.
 */
export async function writeDataset(db: DB, ds: Dataset): Promise<number> {
  let rows = 0;
  await db.transaction(async (tx) => {
    await upsert(tx, s.artists, ds.artists, s.artists.id, ["name", "birthYear", "deathYear", "sitelinks"]);
    await upsert(tx, s.movements, ds.movements, s.movements.id, ["name"]);
    await upsert(tx, s.genres, ds.genres ?? [], s.genres.id, ["name"]);
    await upsert(tx, s.museums, ds.museums, s.museums.id, [
      "name", "city", "country", "lat", "lon", "website", "sitelinks",
    ]);

    await tx.update(s.artworks).set({ inPool: false }).where(sql`${s.artworks.inPool} = true`);
    await upsert(
      tx,
      s.artworks,
      ds.artworks.map((w) => ({ ...w, fame: w.fame ?? 0, updatedAt: new Date() })),
      s.artworks.id,
      ["title", "artistId", "year", "imageFile", "sitelinks", "fame", "museumId", "inPool", "updatedAt"],
    );

    // Link tables and holdings are fully derived: replace them.
    await tx.delete(s.artistMovements);
    for (const c of chunks(ds.artistMovements)) if (c.length) await tx.insert(s.artistMovements).values(c).onConflictDoNothing();
    const ids = new Set(ds.artworks.map((w) => w.id));
    await tx.delete(s.artworkMovements);
    for (const c of chunks(ds.artworkMovements.filter((x) => ids.has(x.artworkId))))
      if (c.length) await tx.insert(s.artworkMovements).values(c).onConflictDoNothing();
    await tx.delete(s.artworkGenres);
    for (const c of chunks((ds.artworkGenres ?? []).filter((x) => ids.has(x.artworkId))))
      if (c.length) await tx.insert(s.artworkGenres).values(c).onConflictDoNothing();
    await tx.delete(s.museumArtistHoldings);
    for (const c of chunks(ds.museumArtistHoldings)) if (c.length) await tx.insert(s.museumArtistHoldings).values(c);
    await tx.delete(s.museumMovementHoldings);
    for (const c of chunks(ds.museumMovementHoldings)) if (c.length) await tx.insert(s.museumMovementHoldings).values(c);

    rows =
      ds.artists.length + ds.movements.length + ds.museums.length + ds.artworks.length +
      ds.artistMovements.length + ds.artworkMovements.length + (ds.artworkGenres?.length ?? 0) +
      ds.museumArtistHoldings.length + ds.museumMovementHoldings.length;
  });
  return rows;
}

/** Full ingestion with ingest_runs bookkeeping. */
export async function logRun<T>(db: DB, pass: string, f: () => Promise<{ result: T; rows: number }>) {
  const [run] = await db.insert(s.ingestRuns).values({ pass }).returning();
  try {
    const { result, rows } = await f();
    await db
      .update(s.ingestRuns)
      .set({ finishedAt: new Date(), rowsUpserted: rows })
      .where(sql`${s.ingestRuns.id} = ${run.id}`);
    return { runId: run.id, result };
  } catch (e) {
    await db
      .update(s.ingestRuns)
      .set({ finishedAt: new Date(), error: String((e as Error)?.stack ?? e).slice(0, 2000) })
      .where(sql`${s.ingestRuns.id} = ${run.id}`);
    throw e;
  }
}
