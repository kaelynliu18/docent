import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { generateNKeysBetween } from "fractional-indexing";
import * as s from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { readSeed, seedArt, seedDemoUser, DEMO_USER_ID } from "@/lib/db/seed";
import { collaborativeFor, getArtworkPage, getRankedList } from "@/lib/server/data";
import { buildTaste } from "@/lib/algo/taste";
import type { Tier } from "@/lib/algo/types";

let db: DB;
let pool: string[];

async function newUser() {
  return (await db.insert(s.users).values({}).returning())[0].id;
}

/** Write a person's ranking directly: ids best-first, split into tiers. */
async function rankDirect(userId: string, tiers: Partial<Record<Tier, string[]>>) {
  for (const [tier, ids] of Object.entries(tiers) as [Tier, string[]][]) {
    if (!ids.length) continue;
    const keys = generateNKeysBetween(null, null, ids.length);
    await db.insert(s.rankings).values(ids.map((artworkId, i) => ({ userId, artworkId, tier, position: keys[i] })));
  }
}

async function tasteOf(userId: string) {
  const list = await getRankedList(db, userId);
  const all = [...list.loved, ...list.fine, ...list.meh];
  const taste = buildTaste(all.map((r) => ({ artworkId: r.id, artistId: r.artistId, artistName: r.artistName, score: r.score, movements: r.movements, genres: r.genres, year: r.year })));
  return { all, taste };
}

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema: s }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "lib/db/migrations" });
  const ds = readSeed();
  await seedArt(db, ds);
  pool = ds.artworks.filter((w) => w.inPool && w.imageFile).map((w) => w.id);
}, 120_000);

describe("collaborative filtering on real rankings", () => {
  it("stays off until enough people share paintings with you", async () => {
    const me = await newUser();
    await rankDirect(me, { loved: pool.slice(0, 5), meh: pool.slice(5, 10) });
    const { all, taste } = await tasteOf(me);
    expect((await collaborativeFor(db, me, all, taste, [pool[20]])).size).toBe(0);
  });

  it("with a like-minded crowd, raises paintings they loved and explains who it's from", async () => {
    const shared = pool.slice(100, 110); // 10 paintings everyone ranks the same way
    const target = pool[120]; // the crowd loves it
    const disliked = pool[121]; // the crowd dislikes it
    for (let u = 0; u < 30; u++) {
      const id = await newUser();
      await rankDirect(id, { loved: [target, ...shared.slice(0, 5)], meh: [...shared.slice(5), disliked] });
    }
    const me = await newUser();
    await rankDirect(me, { loved: shared.slice(0, 5), meh: shared.slice(5) });
    const { all, taste } = await tasteOf(me);
    const cf = await collaborativeFor(db, me, all, taste, [target, disliked]);
    expect(cf.size).toBeGreaterThan(0);
    {
      expect(cf.get(target)!.score).toBeGreaterThan(cf.get(disliked)?.score ?? 0);
      for (const v of cf.values()) {
        expect(v.score).toBeGreaterThanOrEqual(0);
        expect(v.score).toBeLessThanOrEqual(10);
      }
      expect(cf.get(target)!.neighbourTitles.length).toBeGreaterThan(0);
    }
    // Whether or not CF earned trust for this person, the artwork page always answers with a prediction.
    const page = await getArtworkPage(db, me, target);
    expect(page!.prediction!.score).toBeGreaterThanOrEqual(0);
  });

  it("the artwork page explains a prediction with ranked paintings", async () => {
    await seedDemoUser(db);
    const list = await getRankedList(db, DEMO_USER_ID);
    const loved = list.loved[0];
    // Another painting by the demo's favourite artist that it hasn't ranked.
    const ds = readSeed();
    const ranked = new Set([...list.loved, ...list.fine, ...list.meh].map((r) => r.id));
    const other = ds.artworks.find((w) => w.artistId === loved.artistId && !ranked.has(w.id))!;
    const page = await getArtworkPage(db, DEMO_USER_ID, other.id);
    expect(page!.prediction!.why).toMatch(/Because you loved|You tend to like|People who ranked/);
  });
});
