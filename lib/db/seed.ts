import fs from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import type { DB } from "./client";
import * as s from "./schema";
import { writeDataset } from "@/lib/ingest/write";
import type { Dataset } from "@/lib/ingest/types";
import type { Tier } from "@/lib/algo/types";

import { DEMO_EMAIL, DEMO_USER_ID } from "./demo";
export { DEMO_EMAIL, DEMO_USER_ID };

export function readSeed(path = "fixtures/seed.json"): Dataset {
  return JSON.parse(fs.readFileSync(path, "utf8")) as Dataset;
}

export async function seedArt(db: DB, ds: Dataset = readSeed()) {
  return writeDataset(db, ds);
}

/**
 * A demo account with ~25 rankings tilted toward Impressionism, each backed by
 * a "photo" from a museum visit (the Commons image stands in for the photo), plus
 * one recent visit with a few paintings still to rank, so every flow has
 * something to show the moment the demo starts.
 */
export async function seedDemoUser(db: DB, ds: Dataset = readSeed()) {
  await db.delete(s.users).where(eq(s.users.id, DEMO_USER_ID));
  await db.insert(s.users).values({ id: DEMO_USER_ID, email: DEMO_EMAIL, displayName: "Demo visitor" });

  const moveName = new Map(ds.movements.map((m) => [m.id, m.name.toLowerCase()]));
  const movesOf = new Map<string, string[]>();
  for (const am of ds.artworkMovements) {
    movesOf.set(am.artworkId, [...(movesOf.get(am.artworkId) ?? []), moveName.get(am.movementId) ?? ""]);
  }
  const pool = ds.artworks
    .filter((w) => w.inPool && w.imageFile && w.museumId)
    .sort((a, b) => (b.fame ?? 0) - (a.fame ?? 0) || b.sitelinks - a.sitelinks);
  const has = (w: Dataset["artworks"][number], re: RegExp) => (movesOf.get(w.id) ?? []).some((m) => re.test(m));

  const usedArtists = new Map<string, number>();
  const take = (pred: (w: Dataset["artworks"][number]) => boolean, n: number, perArtist = 3) => {
    const out: string[] = [];
    for (const w of pool) {
      if (out.length >= n) break;
      if (!pred(w) || chosen.has(w.id)) continue;
      const c = usedArtists.get(w.artistId) ?? 0;
      if (c >= perArtist) continue;
      usedArtists.set(w.artistId, c + 1);
      chosen.add(w.id);
      out.push(w.id);
    }
    return out;
  };
  const chosen = new Set<string>();
  const impressionist = /impressionism|post-impressionism|pointillism/;
  const loved = [...take((w) => has(w, impressionist), 10), ...take((w) => has(w, /romanticism|realism/), 2)];
  const fine = take((w) => has(w, /renaissance|baroque|dutch golden age/), 8, 2);
  const meh = take((w) => has(w, /surrealism|cubism|abstract|pop art|expressionism/) && !has(w, impressionist), 5, 2);

  const tiers: [Tier, string[]][] = [["loved", loved], ["fine", fine], ["meh", meh]];
  for (const [tier, ids] of tiers) {
    if (!ids.length) continue;
    const keys = generateNKeysBetween(null, null, ids.length);
    await db.insert(s.rankings).values(ids.map((artworkId, i) => ({ userId: DEMO_USER_ID, artworkId, tier, position: keys[i] })));
  }
  // Still to rank: three more from the museum holding the most loved picks.
  const museumOf = new Map(pool.map((w) => [w.id, w.museumId!]));
  const counts = new Map<string, number>();
  for (const id of loved) counts.set(museumOf.get(id)!, (counts.get(museumOf.get(id)!) ?? 0) + 1);
  const recentMuseum = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const pending = recentMuseum ? take((w) => w.museumId === recentMuseum, 3, 3) : [];

  // One visit per museum, spread over the past two years; the pending ones get a visit last week.
  const ranked = [...loved, ...fine, ...meh];
  const museumsVisited = [...new Set(ranked.map((id) => museumOf.get(id)!))];
  const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10);
  const visitIds = new Map<string, string>();
  for (const [i, museumId] of museumsVisited.entries()) {
    const [v] = await db
      .insert(s.visits)
      .values({ userId: DEMO_USER_ID, museumId, visitedOn: day(30 + Math.round((i * 700) / Math.max(1, museumsVisited.length))) })
      .returning({ id: s.visits.id });
    visitIds.set(museumId, v.id);
  }
  if (ranked.length) {
    await db.insert(s.photos).values(ranked.map((artworkId) => ({ userId: DEMO_USER_ID, visitId: visitIds.get(museumOf.get(artworkId)!)!, artworkId })));
  }
  if (pending.length) {
    const [v] = await db.insert(s.visits).values({ userId: DEMO_USER_ID, museumId: recentMuseum!, visitedOn: day(6) }).returning({ id: s.visits.id });
    await db.insert(s.photos).values(pending.map((artworkId) => ({ userId: DEMO_USER_ID, visitId: v.id, artworkId })));
  }
  await db
    .insert(s.museumMarks)
    .values(museumsVisited.map((museumId) => ({ userId: DEMO_USER_ID, museumId, status: "visited" as const })))
    .onConflictDoNothing();

  const total = loved.length + fine.length + meh.length;
  return { total, loved: loved.length, fine: fine.length, meh: meh.length, pending: pending.length, visits: museumsVisited.length + (pending.length ? 1 : 0) };
}

export async function demoUserExists(db: DB) {
  const r = await db.select({ id: s.users.id }).from(s.users).where(inArray(s.users.id, [DEMO_USER_ID]));
  return r.length > 0;
}
