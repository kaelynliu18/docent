import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { readSeed, seedArt, seedDemoUser, DEMO_USER_ID } from "@/lib/db/seed";
import { deleteAccount, signIn, startEmailSignIn, verifyEmailCode } from "@/lib/server/auth";
import { addPhoto, createVisit, getVisits, identifyPhoto, nearestMuseums } from "@/lib/server/visits";
import { sendVisitReminders } from "@/lib/server/push";
import { pruneIdleGuests } from "@/lib/server/maintenance";
import { limit } from "@/lib/server/rate";

let db: DB;
let museum: { id: string; lat: number; lon: number };
let work: string;

const newUser = async (email?: string) => (await db.insert(s.users).values({ email }).returning())[0].id;
const KEY = "aa/" + "5".repeat(32) + ".jpg";

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema: s }) as unknown as DB;
  await migrate(db as never, { migrationsFolder: "lib/db/migrations" });
  const ds = readSeed();
  await seedArt(db, ds);
  const w = ds.artworks.find((a) => a.inPool && a.museumId && ds.museums.find((m) => m.id === a.museumId)?.lat != null)!;
  const m = ds.museums.find((x) => x.id === w.museumId)!;
  museum = { id: m.id, lat: m.lat!, lon: m.lon! };
  work = w.id;
}, 60_000);

describe("email sign-in codes", () => {
  it("verifies the right code once, and counts wrong attempts", async () => {
    const { email, code } = await startEmailSignIn(db, "  Ada@Example.com ", "1.1.1.1");
    expect(email).toBe("ada@example.com");
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await verifyEmailCode(db, email, wrong).catch((e) => e)).code).toBe("wrong_code");
    expect(await verifyEmailCode(db, "ADA@example.com", code)).toBe(email);
    expect((await verifyEmailCode(db, email, code).catch((e) => e)).code).toBe("code_expired"); // single use
  });

  it("locks a code after five wrong tries, and a new code replaces the old", async () => {
    const { email, code: first } = await startEmailSignIn(db, "bo@example.com", "2.2.2.2");
    const { code } = await startEmailSignIn(db, email, "2.2.2.2");
    if (first !== code) expect((await verifyEmailCode(db, email, first).catch((e) => e)).code).toBe("wrong_code");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await verifyEmailCode(db, email, wrong).catch(() => null);
    expect((await verifyEmailCode(db, email, code).catch((e) => e)).code).toBe("too_many_attempts");
  });

  it("rate-limits codes per email", async () => {
    for (let i = 0; i < 5; i++) await startEmailSignIn(db, "spam@example.com", `9.9.9.${i}`);
    expect((await startEmailSignIn(db, "spam@example.com", "9.9.9.9").catch((e) => e)).code).toBe("rate_limited");
  });

  it("rejects bad emails and codes", async () => {
    expect((await startEmailSignIn(db, "nope", "3.3.3.3").catch((e) => e)).code).toBe("bad_email");
    expect((await verifyEmailCode(db, "ada@example.com", "12ab").catch((e) => e)).code).toBe("bad_code");
  });
});

describe("signIn carries guest data over", () => {
  it("first sign-in upgrades the guest in place", async () => {
    const guest = await newUser();
    await createVisit(db, guest, { museumId: museum.id, visitedOn: "2026-05-01" });
    const id = await signIn(db, { email: "new@example.com" }, guest);
    expect(id).toBe(guest);
    const [u] = await db.select().from(s.users).where(eq(s.users.id, guest));
    expect(u.email).toBe("new@example.com");
  });

  it("signing into an existing account merges the guest's visits and photos into it", async () => {
    const account = await newUser("old@example.com");
    const guest = await newUser();
    const v = await createVisit(db, guest, { museumId: museum.id, visitedOn: "2026-05-02" });
    const p = await addPhoto(db, guest, v.id, { storageKey: KEY, width: 1, height: 1 });
    await identifyPhoto(db, guest, p.id, { title: "Hand-added" });
    expect(await signIn(db, { email: "OLD@example.com" }, guest)).toBe(account);
    expect((await getVisits(db, account)).map((x) => x.id)).toContain(v.id);
    expect(await db.select().from(s.users).where(eq(s.users.id, guest))).toEqual([]);
    const owned = await db.select().from(s.artworks).where(eq(s.artworks.ownerId, account));
    expect(owned.map((a) => a.title)).toContain("Hand-added");
  });

  it("Google links to the email account and is found by its id afterwards", async () => {
    const account = await newUser("g@example.com");
    expect(await signIn(db, { email: "g@example.com", googleSub: "sub-1" }, null)).toBe(account);
    expect(await signIn(db, { email: "changed@example.com", googleSub: "sub-1" }, null)).toBe(account);
  });

  it("never merges the demo account into anyone", async () => {
    await seedDemoUser(db);
    const id = await signIn(db, { email: "demo-visitor@example.com" }, DEMO_USER_ID);
    expect(id).not.toBe(DEMO_USER_ID);
    expect((await getVisits(db, DEMO_USER_ID)).length).toBeGreaterThan(0);
  });
});

describe("account safety", () => {
  it("deleting an account removes its data and returns photo keys to clean up", async () => {
    const u = await newUser("bye@example.com");
    const v = await createVisit(db, u, { museumId: museum.id, visitedOn: "2026-05-03" });
    await addPhoto(db, u, v.id, { storageKey: KEY, width: 1, height: 1 });
    expect(await deleteAccount(db, u)).toEqual([KEY]);
    expect(await db.select().from(s.visits).where(eq(s.visits.userId, u))).toEqual([]);
    expect((await deleteAccount(db, DEMO_USER_ID).catch((e) => e)).code).toBe("demo");
  });

  it("the demo account can add visits and photos like any account", async () => {
    await seedDemoUser(db);
    const v = await createVisit(db, DEMO_USER_ID, { museumId: museum.id, visitedOn: "2026-05-04" });
    await addPhoto(db, DEMO_USER_ID, v.id, { storageKey: KEY, width: 1, height: 1 });
    const visit = await getVisits(db, DEMO_USER_ID);
    expect(visit.some((x) => x.id === v.id)).toBe(true);
  });

  it("same museum and day reuses the visit", async () => {
    const u = await newUser();
    const a = await createVisit(db, u, { museumId: museum.id, visitedOn: "2026-05-05" });
    const b = await createVisit(db, u, { museumId: museum.id, visitedOn: "2026-05-05" });
    expect(b.id).toBe(a.id);
    expect(b.reused).toBe(true);
  });

  it("rate limiter allows max events per window", async () => {
    for (let i = 0; i < 3; i++) await limit(db, "t:key", 3, 60, "slow down");
    expect((await limit(db, "t:key", 3, 60, "slow down").catch((e) => e)).status).toBe(429);
  });
});

describe("photo locations, reminders, cleanup", () => {
  it("finds the museum a photo was taken at, and nothing in the middle of nowhere", async () => {
    const [hit, miss] = await nearestMuseums(db, [
      { lat: museum.lat + 0.001, lon: museum.lon },
      { lat: 0, lon: -140 },
    ]);
    expect(hit?.museum.id).toBe(museum.id);
    expect(miss).toBeNull();
  });

  it("considers each visit once for a reminder", async () => {
    const u = await newUser("remind@example.com");
    const v = await createVisit(db, u, { museumId: museum.id, visitedOn: "2026-05-06" });
    const p = await addPhoto(db, u, v.id, { storageKey: KEY, width: 1, height: 1 });
    await identifyPhoto(db, u, p.id, { artworkId: work });
    const later = new Date(Date.now() + 13 * 3600 * 1000);
    const first = await sendVisitReminders(db, later);
    expect(first.considered).toBeGreaterThan(0);
    const [row] = await db.select().from(s.visits).where(eq(s.visits.id, v.id));
    expect(row.notifiedAt).not.toBeNull();
    const again = await sendVisitReminders(db, later);
    expect(again.considered).toBe(0);
  });

  it("prunes guests who never did anything after 30 days, and nobody else", async () => {
    const idle = await newUser();
    const active = await newUser();
    await createVisit(db, active, { museumId: museum.id, visitedOn: "2026-05-07" });
    const future = new Date(Date.now() + 31 * 86400 * 1000);
    expect(await pruneIdleGuests(db, future)).toBeGreaterThan(0);
    expect(await db.select().from(s.users).where(eq(s.users.id, idle))).toEqual([]);
    expect((await db.select().from(s.users).where(eq(s.users.id, active))).length).toBe(1);
    expect((await db.select().from(s.users).where(eq(s.users.id, DEMO_USER_ID))).length).toBe(1);
  });
});
