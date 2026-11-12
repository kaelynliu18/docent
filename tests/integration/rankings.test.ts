import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { readSeed, seedArt, seedDemoUser, DEMO_USER_ID } from "@/lib/db/seed";
import {
  deleteRanking,
  getMuseumMatches,
  getPending,
  getRankedList,
  getTasteProfile,
  getTierForSearch,
  insertRanking,
  mergeGuestInto,
} from "@/lib/server/data";
import { ApiError } from "@/lib/server/errors";
import { users } from "@/lib/db/schema";
import * as s from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { addPhoto, createVisit, getVisit, getVisits, identifyCandidates, identifyPhoto, pendingArtworkIds } from "@/lib/server/visits";
import { answer, currentOpponent, slotNeighbours, startInsertion } from "@/lib/algo/insertion";

let db: DB;
let pool: string[];
let museumOf: Map<string, string>;

async function newUser() {
  const [u] = await db.insert(users).values({}).returning();
  return u.id;
}

/** Log a visit to the painting's museum with a (storage-less) photo of it: ranking requires one. */
async function photograph(userId: string, artworkId: string) {
  const v = await createVisit(db, userId, { museumId: museumOf.get(artworkId)!, visitedOn: "2026-10-01" });
  const p = await addPhoto(db, userId, v.id, { storageKey: "00/" + "0".repeat(32) + ".jpg", width: 800, height: 600 });
  await identifyPhoto(db, userId, p.id, { artworkId });
  return { visitId: v.id, photoId: p.id };
}

/** Drive the real binary search with a fixed preference, then POST it. */
async function rank(userId: string, artworkId: string, tier: "loved" | "fine" | "meh", prefer: (other: string) => boolean) {
  if (museumOf.has(artworkId)) await photograph(userId, artworkId); // hand-added ones already have their photo
  const { items } = await getTierForSearch(db, userId, tier);
  let s = startInsertion(artworkId, items.map((i) => i.artworkId));
  while (s.index === null) s = answer(s, prefer(currentOpponent(s)!) ? "new" : "item");
  return insertRanking(db, userId, { artworkId, tier, ...slotNeighbours(s), comparisons: s.comparisons });
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "lib/db/migrations" });
  const ds = readSeed();
  await seedArt(db, ds);
  const usable = ds.artworks.filter((w) => w.inPool && w.imageFile && w.museumId);
  pool = usable.map((w) => w.id);
  museumOf = new Map(usable.map((w) => [w.id, w.museumId!]));
}, 60_000);

describe("POST /api/rankings logic", () => {
  it("inserts in order and scores live", async () => {
    const u = await newUser();
    const order = pool.slice(0, 6); // true preference: index order
    for (const id of order) await rank(u, id, "loved", (other) => order.indexOf(id) < order.indexOf(other));
    const list = await getRankedList(db, u);
    expect(list.loved.map((r) => r.id)).toEqual(order);
    expect(list.loved[0].score).toBeGreaterThan(list.loved[5].score);
    expect(list.loved[0].rank).toBe(1);
  });

  it("returns 409 slot_moved when the neighbours are no longer adjacent", async () => {
    const u = await newUser();
    const [a, b, c, x] = pool.slice(10, 14);
    await rank(u, a, "fine", () => false);
    await rank(u, b, "fine", () => false); // [a, b]
    // Client computed slot between a and b, but another tab inserts c there first.
    await photograph(u, c);
    await photograph(u, x);
    await insertRanking(db, u, { artworkId: c, tier: "fine", aboveId: a, belowId: b, comparisons: [] });
    const err = await insertRanking(db, u, {
      artworkId: x, tier: "fine", aboveId: a, belowId: b, comparisons: [],
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("slot_moved");
  });

  it("rejects duplicates, bad tiers and foreign comparisons", async () => {
    const u = await newUser();
    const [a, b, z] = pool.slice(20, 23);
    await rank(u, a, "meh", () => true);
    await photograph(u, b);
    const dup = await insertRanking(db, u, { artworkId: a, tier: "meh", aboveId: null, belowId: null, comparisons: [] }).catch((e) => e);
    expect(dup.code).toBe("already_ranked");
    const badTier = await insertRanking(db, u, { artworkId: b, tier: "great", aboveId: null, belowId: a, comparisons: [] }).catch((e) => e);
    expect(badTier.name).toBe("ZodError");
    const foreign = await insertRanking(db, u, {
      artworkId: b, tier: "meh", aboveId: null, belowId: a,
      comparisons: [{ winnerId: b, loserId: z, wasTie: false }],
    }).catch((e) => e);
    expect(foreign.code).toBe("bad_comparisons");
  });

  it("delete then re-rank works", async () => {
    const u = await newUser();
    const [a, b] = pool.slice(30, 32);
    await rank(u, a, "loved", () => true);
    await rank(u, b, "loved", () => true);
    await deleteRanking(db, u, a);
    expect(await getPending(db, u)).toHaveLength(1); // photographed, so it's back in the queue
    await rank(u, a, "fine", () => true);
    const list = await getRankedList(db, u);
    expect(list.loved.map((r) => r.id)).toEqual([b]);
    expect(list.fine.map((r) => r.id)).toEqual([a]);
  });
});

describe("queue, taste and museums on seed data", () => {
  it("only photographed paintings can be ranked, and pending lists exactly those", async () => {
    const u = await newUser();
    const [a, b, c] = pool.slice(60, 63);
    const never = await insertRanking(db, u, { artworkId: a, tier: "loved", aboveId: null, belowId: null, comparisons: [] }).catch((e) => e);
    expect(never.code).toBe("not_photographed");
    await photograph(u, a);
    await photograph(u, b);
    await rank(u, c, "loved", () => true);
    const pending = await getPending(db, u);
    expect(pending.map((p) => p.id).sort()).toEqual([a, b].sort());
  });

  it("museum matches stay locked until 5 rankings with a loved one", async () => {
    const u = await newUser();
    for (const id of pool.slice(40, 43)) await rank(u, id, "fine", () => true);
    const r = await getMuseumMatches(db, u, {});
    expect(r.locked?.needed).toBe(2);
  });

  it("demo user gets Impressionist-leaning matches anywhere and near San Francisco", async () => {
    const demo = await seedDemoUser(db);
    expect(demo.total).toBeGreaterThanOrEqual(20);
    const taste = await getTasteProfile(db, DEMO_USER_ID);
    expect(taste.movements.some((m) => /impression/i.test(m.name))).toBe(true);
    const anywhere = await getMuseumMatches(db, DEMO_USER_ID, {});
    expect(anywhere.locked).toBeNull();
    expect(anywhere.matches.length).toBeGreaterThan(5);
    expect(anywhere.matches[0].matchPct).toBe(100);
    expect(anywhere.matches[0].reasons.length).toBeGreaterThan(0);
    const sf = await getMuseumMatches(db, DEMO_USER_ID, { lat: 37.7749, lon: -122.4194, radiusKm: 200 });
    for (const m of sf.matches) expect(m.distanceKm!).toBeLessThanOrEqual(200);
  });

  it("taste profile includes subjects and eras; matches re-rank with the masterpiece term", async () => {
    const taste = await getTasteProfile(db, DEMO_USER_ID);
    expect(taste.genres.length).toBeGreaterThan(0);
    expect(taste.periods.some((p) => p.id === "C19")).toBe(true);
    const res = await getMuseumMatches(db, DEMO_USER_ID, {});
    // Reasons stay holdings-based ("N by Artist" / "N X works"), never the hidden masterpiece text.
    for (const m of res.matches) for (const r of m.reasons) expect(r).not.toMatch(/predicted/);
  });

  it("merges guest rankings into an account", async () => {
    const guest = await newUser();
    const account = await newUser();
    await rank(account, pool[50], "loved", () => true);
    await rank(guest, pool[51], "loved", () => true);
    await rank(guest, pool[50], "fine", () => true); // conflict: account's placement wins
    await mergeGuestInto(db, guest, account);
    const list = await getRankedList(db, account);
    expect(list.loved.map((r) => r.id)).toEqual([pool[50], pool[51]]);
    expect(list.fine).toEqual([]);
    expect((await getVisits(db, account)).length).toBe(3); // 1 of its own + the guest's 2
  });
});

describe("visits and photos", () => {
  it("identifies photos from the museum's list, the whole catalogue, or by hand", async () => {
    const u = await newUser();
    const museumId = museumOf.get(pool[0])!;
    const v = await createVisit(db, u, { museumId, visitedOn: "2026-09-12" });
    const key = "ab/" + "1".repeat(32) + ".jpg";
    const p1 = await addPhoto(db, u, v.id, { storageKey: key, width: 1200, height: 900 });
    const p2 = await addPhoto(db, u, v.id, { storageKey: key, width: 900, height: 1200 });
    const p3 = await addPhoto(db, u, v.id, { storageKey: key, width: null, height: null });

    const here = await identifyCandidates(db, u, v.id, { scope: "museum" });
    expect(here.length).toBeGreaterThan(0);
    expect(here.some((c) => c.id === pool[0])).toBe(true);
    const all = await identifyCandidates(db, u, v.id, { scope: "all", q: "starry" });
    expect(all.some((c) => /starry/i.test(c.title))).toBe(true);

    await identifyPhoto(db, u, p1.id, { artworkId: pool[0] });
    const { artworkId: custom } = await identifyPhoto(db, u, p2.id, { title: "Small harbour study", artist: "Unknown local painter" });
    expect(custom).toMatch(/^X[0-9a-f]{32}$/);

    let visit = (await getVisit(db, u, v.id))!;
    expect(visit.toIdentify).toBe(1);
    expect(visit.toRank).toBe(2);
    expect(visit.photos.find((p) => p.id === p2.id)!.artwork).toMatchObject({ title: "Small harbour study", artistName: "Unknown local painter", custom: true });
    expect(visit.photos.find((p) => p.id === p1.id)!.url).toBe(`/api/photos/${p1.id}`);

    // Hand-added paintings rank like any other, and never shape taste.
    await rank(u, custom!, "loved", () => true);
    const list = await getRankedList(db, u);
    expect(list.loved[0]).toMatchObject({ id: custom, artistName: "Unknown local painter", custom: true });
    expect(list.loved[0].imageUrl).toBe(`/api/photos/${p2.id}`);
    const taste = await getTasteProfile(db, u);
    expect(taste.artists.some((a) => a.id === "X0")).toBe(false);

    await identifyPhoto(db, u, p3.id, { clear: true });
    visit = (await getVisit(db, u, v.id))!;
    expect(visit.toIdentify).toBe(1);
    expect(await pendingArtworkIds(db, u, { visitId: v.id })).toEqual([pool[0]]);
  });

  it("keeps visits, photos and hand-added paintings private to their owner", async () => {
    const owner = await newUser();
    const other = await newUser();
    const v = await createVisit(db, owner, { museumId: museumOf.get(pool[1])!, visitedOn: "2026-08-01" });
    const p = await addPhoto(db, owner, v.id, { storageKey: "cd/" + "2".repeat(32) + ".jpg", width: 10, height: 10 });
    const { artworkId } = await identifyPhoto(db, owner, p.id, { title: "Private find" });

    expect(await getVisit(db, other, v.id)).toBeNull();
    expect((await addPhoto(db, other, v.id, { storageKey: "cd/" + "3".repeat(32) + ".jpg", width: 1, height: 1 }).catch((e) => e)).code).toBe("not_found");
    expect((await identifyPhoto(db, other, p.id, { artworkId: pool[1] }).catch((e) => e)).code).toBe("not_found");

    // Another user can't attach someone else's hand-added painting to their own photo, or rank it.
    const v2 = await createVisit(db, other, { museumId: museumOf.get(pool[1])!, visitedOn: "2026-08-02" });
    const p2 = await addPhoto(db, other, v2.id, { storageKey: "cd/" + "4".repeat(32) + ".jpg", width: 1, height: 1 });
    expect((await identifyPhoto(db, other, p2.id, { artworkId: artworkId! }).catch((e) => e)).code).toBe("not_found");
    const steal = await insertRanking(db, other, { artworkId: artworkId!, tier: "loved", aboveId: null, belowId: null, comparisons: [] }).catch((e) => e);
    expect(steal.code).toBe("not_found");
    const search = await identifyCandidates(db, other, v2.id, { scope: "all", q: "Private find" });
    expect(search).toEqual([]);
  });

  it("logging a visit marks the museum visited and rejects future dates", async () => {
    const u = await newUser();
    const museumId = museumOf.get(pool[2])!;
    await createVisit(db, u, { museumId, visitedOn: "2026-01-05" });
    const [mark] = await db.select().from(s.museumMarks).where(eq(s.museumMarks.userId, u));
    expect(mark).toMatchObject({ museumId, status: "visited" });
    const future = await createVisit(db, u, { museumId, visitedOn: "2999-01-01" }).catch((e) => e);
    expect(future.code).toBe("bad_date");
  });

  it("demo account has visits behind every ranking and a recent visit to rank", async () => {
    const demo = await seedDemoUser(db);
    expect(demo.pending).toBe(3);
    const visits = await getVisits(db, DEMO_USER_ID);
    expect(visits.length).toBe(demo.visits);
    expect(visits[0].toRank).toBe(3);
    expect((await getPending(db, DEMO_USER_ID)).length).toBe(3);
  });
});
