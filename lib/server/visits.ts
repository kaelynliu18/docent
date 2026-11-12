import crypto from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { ARTWORK_ID_RE, UNKNOWN_ARTIST_ID } from "@/lib/algo/types";
import { haversineKm } from "@/lib/algo/match";
import { commonsImage } from "@/lib/images";
import { ApiError } from "./errors";
import { assertNotDemo } from "./auth";
import { limit } from "./rate";

/**
 * Visits: a user logs a trip to a museum, uploads the photos they took, and
 * says which painting each one shows. Only paintings they photographed can be
 * ranked. Takes `db` and `userId` like data.ts so it's testable.
 */

export const photoUrl = (p: { id: string; storageKey: string | null }, imageFile: string | null, thumb = false) =>
  p.storageKey ? `/api/photos/${p.id}${thumb ? "?size=thumb" : ""}` : commonsImage(imageFile, thumb ? 240 : 1000);

/** User text inside ILIKE: escape the wildcards so "100%" means 100%. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;

/* ───────── Museums picker ───────── */

export async function searchMuseums(db: DB, opts: { q?: string; lat?: number | null; lon?: number | null; limit?: number }) {
  const q = opts.q?.trim();
  const works = sql<number>`(select count(*)::int from artworks a where a.museum_id = "museums"."id" and a.owner_id is null)`;
  const rows = await db
    .select({
      id: s.museums.id,
      name: s.museums.name,
      city: s.museums.city,
      country: s.museums.country,
      lat: s.museums.lat,
      lon: s.museums.lon,
      sitelinks: s.museums.sitelinks,
      works,
    })
    .from(s.museums)
    .where(q ? or(ilike(s.museums.name, like(q)), ilike(s.museums.city, like(q))) : undefined)
    // Art museums first: a palace with many Wikipedia languages but no paintings listed shouldn't lead.
    .orderBy(desc(works), desc(s.museums.sitelinks))
    .limit(q ? 40 : 400);
  const origin = opts.lat != null && opts.lon != null ? { lat: opts.lat, lon: opts.lon } : null;
  const withDist = rows.map((m) => ({
    ...m,
    distanceKm: origin && m.lat != null && m.lon != null ? Math.round(haversineKm(origin, { lat: m.lat, lon: m.lon })) : null,
  }));
  if (origin) withDist.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  return withDist.slice(0, opts.limit ?? 20);
}

export async function museumForPicker(db: DB, id: string) {
  if (!/^Q\d+$/.test(id)) return null;
  const [m] = await db
    .select({
      id: s.museums.id,
      name: s.museums.name,
      city: s.museums.city,
      country: s.museums.country,
      works: sql<number>`(select count(*)::int from artworks a where a.museum_id = "museums"."id" and a.owner_id is null)`,
    })
    .from(s.museums)
    .where(eq(s.museums.id, id));
  return m ? { ...m, distanceKm: null } : null;
}

/* ───────── Visits ───────── */

export const createVisitBody = z.object({
  museumId: z.string().regex(/^Q\d+$/),
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function createVisit(db: DB, userId: string, raw: unknown) {
  assertNotDemo(userId);
  const body = createVisitBody.parse(raw);
  await limit(db, `visit:${userId}`, 60, 86400, "That's a lot of visits for one day. Try again tomorrow.");
  const day = new Date(body.visitedOn + "T00:00:00Z");
  if (Number.isNaN(day.getTime()) || day.getTime() > Date.now() + 36 * 3600 * 1000) {
    throw new ApiError(400, "bad_date", "Pick the day you went (it can't be in the future).");
  }
  const [museum] = await db.select({ id: s.museums.id }).from(s.museums).where(eq(s.museums.id, body.museumId));
  if (!museum) throw new ApiError(404, "not_found", "We couldn't find that museum.");
  // Same museum, same day: add to that visit rather than making a duplicate.
  const [same] = await db
    .select()
    .from(s.visits)
    .where(and(eq(s.visits.userId, userId), eq(s.visits.museumId, body.museumId), eq(s.visits.visitedOn, body.visitedOn)));
  if (same) return { ...same, reused: true };
  const [v] = await db.insert(s.visits).values({ userId, museumId: body.museumId, visitedOn: body.visitedOn }).returning();
  await db
    .insert(s.museumMarks)
    .values({ userId, museumId: body.museumId, status: "visited" })
    .onConflictDoUpdate({ target: [s.museumMarks.userId, s.museumMarks.museumId], set: { status: "visited" } });
  return { ...v, reused: false };
}

/* ───────── Nearest museum (for photo locations) ───────── */

type MuseumPoint = { id: string; name: string; city: string | null; country: string | null; lat: number; lon: number };
let museumPoints: { at: number; rows: MuseumPoint[] } | null = null;

/** For each point, the closest museum within `maxKm` (or null). Museum coordinates are cached per process for 10 min. */
export async function nearestMuseums(db: DB, points: { lat: number; lon: number }[], maxKm = 1.5) {
  if (!museumPoints || Date.now() - museumPoints.at > 600_000) {
    const rows = await db
      .select({ id: s.museums.id, name: s.museums.name, city: s.museums.city, country: s.museums.country, lat: s.museums.lat, lon: s.museums.lon })
      .from(s.museums)
      .where(sql`${s.museums.lat} is not null and ${s.museums.lon} is not null`);
    museumPoints = { at: Date.now(), rows: rows as MuseumPoint[] };
  }
  return points.map((p) => {
    let best: MuseumPoint | null = null;
    let bestKm = Infinity;
    for (const m of museumPoints!.rows) {
      const d = haversineKm(p, m);
      if (d < bestKm) {
        bestKm = d;
        best = m;
      }
    }
    return best && bestKm <= maxKm ? { museum: { id: best.id, name: best.name, city: best.city, country: best.country }, distanceKm: Math.round(bestKm * 100) / 100 } : null;
  });
}

async function ownVisit(db: DB, userId: string, visitId: string) {
  if (!/^[0-9a-f-]{36}$/.test(visitId)) throw new ApiError(404, "not_found", "We couldn't find that visit.");
  const [v] = await db
    .select({
      id: s.visits.id,
      visitedOn: s.visits.visitedOn,
      museumId: s.museums.id,
      museumName: s.museums.name,
      city: s.museums.city,
      country: s.museums.country,
    })
    .from(s.visits)
    .innerJoin(s.museums, eq(s.museums.id, s.visits.museumId))
    .where(and(eq(s.visits.id, visitId), eq(s.visits.userId, userId)));
  if (!v) throw new ApiError(404, "not_found", "We couldn't find that visit.");
  return v;
}

export type VisitPhoto = {
  id: string;
  url: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  artwork: { id: string; title: string; artistName: string; year: number | null; custom: boolean } | null;
  score: number | null;
};

async function photosWhere(db: DB, userId: string, visitIds: string[]) {
  if (!visitIds.length) return [];
  return db
    .select({
      id: s.photos.id,
      visitId: s.photos.visitId,
      storageKey: s.photos.storageKey,
      width: s.photos.width,
      height: s.photos.height,
      artworkId: s.photos.artworkId,
      title: s.artworks.title,
      year: s.artworks.year,
      imageFile: s.artworks.imageFile,
      ownerId: s.artworks.ownerId,
      artistName: sql<string | null>`coalesce(${s.artworks.artistLabel}, ${s.artists.name})`,
      ranked: sql<boolean>`exists (select 1 from rankings r where r.user_id = ${userId} and r.artwork_id = ${s.photos.artworkId})`,
    })
    .from(s.photos)
    .leftJoin(s.artworks, eq(s.artworks.id, s.photos.artworkId))
    .leftJoin(s.artists, eq(s.artists.id, s.artworks.artistId))
    .where(and(eq(s.photos.userId, userId), inArray(s.photos.visitId, visitIds)))
    .orderBy(asc(s.photos.createdAt), asc(s.photos.id));
}

export async function getVisits(db: DB, userId: string | null) {
  if (!userId) return [];
  const vs = await db
    .select({
      id: s.visits.id,
      visitedOn: s.visits.visitedOn,
      museumId: s.museums.id,
      museumName: s.museums.name,
      city: s.museums.city,
      country: s.museums.country,
    })
    .from(s.visits)
    .innerJoin(s.museums, eq(s.museums.id, s.visits.museumId))
    .where(eq(s.visits.userId, userId))
    .orderBy(desc(s.visits.visitedOn), desc(s.visits.createdAt));
  const ps = await photosWhere(db, userId, vs.map((v) => v.id));
  return vs.map((v) => {
    const mine = ps.filter((p) => p.visitId === v.id);
    return {
      ...v,
      photoCount: mine.length,
      toIdentify: mine.filter((p) => !p.artworkId).length,
      toRank: new Set(mine.filter((p) => p.artworkId && !p.ranked).map((p) => p.artworkId)).size,
      thumbs: mine.slice(0, 5).map((p) => ({ id: p.id, url: photoUrl(p, p.imageFile, true) })),
    };
  });
}

export async function getVisit(db: DB, userId: string | null, visitId: string) {
  if (!userId) return null;
  const v = await ownVisit(db, userId, visitId).catch(() => null);
  if (!v) return null;
  const ps = await photosWhere(db, userId, [v.id]);
  const ids = [...new Set(ps.map((p) => p.artworkId).filter((x): x is string => !!x))];
  const scores = await scoresFor(db, userId, ids);
  const photos: VisitPhoto[] = ps.map((p) => ({
    id: p.id,
    url: photoUrl(p, p.imageFile),
    thumbUrl: photoUrl(p, p.imageFile, true),
    width: p.width,
    height: p.height,
    artwork: p.artworkId
      ? { id: p.artworkId, title: p.title!, artistName: p.artistName ?? "Unknown artist", year: p.year, custom: !!p.ownerId }
      : null,
    score: p.artworkId ? (scores.get(p.artworkId) ?? null) : null,
  }));
  const [u] = await db.select({ hideNudity: s.users.hideNudity }).from(s.users).where(eq(s.users.id, userId));
  return {
    visit: v,
    hideNudity: u?.hideNudity ?? false,
    photos,
    toIdentify: photos.filter((p) => !p.artwork).length,
    toRank: new Set(photos.filter((p) => p.artwork && p.score == null).map((p) => p.artwork!.id)).size,
  };
}

/** Live scores for a few artworks, computed the same way as the ranked list. */
async function scoresFor(db: DB, userId: string, ids: string[]) {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { getRankedList } = await import("./data");
  const list = await getRankedList(db, userId);
  for (const r of [...list.loved, ...list.fine, ...list.meh]) if (ids.includes(r.id)) out.set(r.id, r.score);
  return out;
}

export async function deleteVisit(db: DB, userId: string, visitId: string) {
  assertNotDemo(userId, "delete visits");
  await ownVisit(db, userId, visitId);
  const ps = await db
    .select({ key: s.photos.storageKey })
    .from(s.photos)
    .where(and(eq(s.photos.visitId, visitId), eq(s.photos.userId, userId)));
  await db.delete(s.visits).where(and(eq(s.visits.id, visitId), eq(s.visits.userId, userId)));
  return ps.map((p) => p.key).filter((k): k is string => !!k);
}

/* ───────── Photos ───────── */

export async function addPhoto(
  db: DB,
  userId: string,
  visitId: string,
  p: { storageKey: string; width: number | null; height: number | null },
) {
  assertNotDemo(userId);
  await ownVisit(db, userId, visitId);
  const [row] = await db.insert(s.photos).values({ userId, visitId, ...p }).returning();
  return row;
}

export async function getPhotoKey(db: DB, userId: string | null, photoId: string) {
  if (!userId || !/^[0-9a-f-]{36}$/.test(photoId)) return null;
  const [p] = await db
    .select({ key: s.photos.storageKey })
    .from(s.photos)
    .where(and(eq(s.photos.id, photoId), eq(s.photos.userId, userId)));
  return p?.key ?? null;
}

/** Check before storing bytes, so a refused upload never touches storage. */
export async function assertCanUpload(db: DB, userId: string, visitId: string) {
  assertNotDemo(userId);
  await ownVisit(db, userId, visitId);
  await limit(db, `upload:${userId}`, 600, 86400, "You've uploaded a lot today. Try the rest tomorrow.");
}

export async function removePhoto(db: DB, userId: string, photoId: string) {
  assertNotDemo(userId, "remove photos");
  if (!/^[0-9a-f-]{36}$/.test(photoId)) throw new ApiError(404, "not_found", "We couldn't find that photo.");
  const [p] = await db
    .delete(s.photos)
    .where(and(eq(s.photos.id, photoId), eq(s.photos.userId, userId)))
    .returning({ key: s.photos.storageKey });
  if (!p) throw new ApiError(404, "not_found", "We couldn't find that photo.");
  return p.key;
}

export const identifyBody = z.union([
  z.object({ artworkId: z.string().regex(ARTWORK_ID_RE) }),
  z.object({ title: z.string().trim().min(1).max(200), artist: z.string().trim().max(120).optional() }),
  z.object({ clear: z.literal(true) }),
]);

/** Say which painting a photo shows: a catalogue work, a new hand-added one, or "not sure yet". */
export async function identifyPhoto(db: DB, userId: string, photoId: string, raw: unknown) {
  assertNotDemo(userId, "change photos");
  const body = identifyBody.parse(raw);
  if (!/^[0-9a-f-]{36}$/.test(photoId)) throw new ApiError(404, "not_found", "We couldn't find that photo.");
  const [photo] = await db
    .select({ id: s.photos.id })
    .from(s.photos)
    .where(and(eq(s.photos.id, photoId), eq(s.photos.userId, userId)));
  if (!photo) throw new ApiError(404, "not_found", "We couldn't find that photo.");

  let artworkId: string | null = null;
  if ("artworkId" in body) {
    const [a] = await db
      .select({ id: s.artworks.id, ownerId: s.artworks.ownerId })
      .from(s.artworks)
      .where(eq(s.artworks.id, body.artworkId));
    if (!a || (a.ownerId && a.ownerId !== userId)) throw new ApiError(404, "not_found", "We couldn't find that painting.");
    artworkId = a.id;
  } else if ("title" in body) {
    artworkId = "X" + crypto.randomBytes(16).toString("hex");
    await db.insert(s.artworks).values({
      id: artworkId,
      title: body.title,
      artistId: UNKNOWN_ARTIST_ID,
      artistLabel: body.artist || null,
      ownerId: userId,
    });
  }
  await db.update(s.photos).set({ artworkId }).where(eq(s.photos.id, photoId));
  return { artworkId };
}

/** Paintings to pick from when identifying a photo: that museum's first, or the whole catalogue. */
export async function identifyCandidates(
  db: DB,
  userId: string,
  visitId: string,
  opts: { q?: string; scope: "museum" | "all" },
) {
  const v = await ownVisit(db, userId, visitId);
  const q = opts.q?.trim();
  const text = q
    ? or(ilike(s.artworks.title, like(q)), ilike(s.artists.name, like(q)), ilike(s.artworks.artistLabel, like(q)))
    : undefined;
  const where =
    opts.scope === "museum"
      ? and(eq(s.artworks.museumId, v.museumId), isNull(s.artworks.ownerId), text)
      : and(or(isNull(s.artworks.ownerId), eq(s.artworks.ownerId, userId)), text);
  if (opts.scope === "all" && !q) return [];
  const rows = await db
    .select({
      id: s.artworks.id,
      title: s.artworks.title,
      year: s.artworks.year,
      imageFile: s.artworks.imageFile,
      nudity: s.artworks.nudity,
      artistName: sql<string>`coalesce(${s.artworks.artistLabel}, ${s.artists.name})`,
    })
    .from(s.artworks)
    .innerJoin(s.artists, eq(s.artists.id, s.artworks.artistId))
    .where(where)
    .orderBy(desc(s.artworks.fame), desc(s.artworks.sitelinks), asc(s.artworks.title))
    .limit(60);
  return rows.map((r) => ({ id: r.id, title: r.title, year: r.year, artistName: r.artistName, nudity: r.nudity, thumbUrl: commonsImage(r.imageFile, 240) }));
}

/* ───────── What's left to rank ───────── */

/** Identified, unranked, not-skipped paintings from the user's visits, newest visit first. */
export async function pendingArtworkIds(db: DB, userId: string | null, opts: { visitId?: string } = {}) {
  if (!userId) return [];
  const ranked = db.select({ id: s.rankings.artworkId }).from(s.rankings).where(eq(s.rankings.userId, userId));
  const skipped = db.select({ id: s.skips.artworkId }).from(s.skips).where(eq(s.skips.userId, userId));
  const rows = await db
    .select({ artworkId: s.photos.artworkId })
    .from(s.photos)
    .innerJoin(s.visits, eq(s.visits.id, s.photos.visitId))
    .where(
      and(
        eq(s.photos.userId, userId),
        sql`${s.photos.artworkId} is not null`,
        notInArray(s.photos.artworkId, ranked),
        notInArray(s.photos.artworkId, skipped),
        opts.visitId && /^[0-9a-f-]{36}$/.test(opts.visitId) ? eq(s.photos.visitId, opts.visitId) : undefined,
      ),
    )
    .orderBy(desc(s.visits.visitedOn), asc(s.photos.createdAt));
  return [...new Set(rows.map((r) => r.artworkId!))];
}

/** The user's own photo of each painting (latest), to show instead of the Commons image. */
export async function userPhotoMap(db: DB, userId: string | null, artworkIds: string[]) {
  const out = new Map<string, { url: string; thumbUrl: string }>();
  if (!userId || !artworkIds.length) return out;
  const rows = await db
    .select({ id: s.photos.id, artworkId: s.photos.artworkId, storageKey: s.photos.storageKey })
    .from(s.photos)
    .where(and(eq(s.photos.userId, userId), inArray(s.photos.artworkId, artworkIds), sql`${s.photos.storageKey} is not null`))
    .orderBy(desc(s.photos.createdAt));
  for (const r of rows) {
    if (!out.has(r.artworkId!)) out.set(r.artworkId!, { url: photoUrl(r, null)!, thumbUrl: photoUrl(r, null, true)! });
  }
  return out;
}

export async function hasPhotoOf(db: DB, userId: string, artworkId: string) {
  const [p] = await db
    .select({ id: s.photos.id })
    .from(s.photos)
    .where(and(eq(s.photos.userId, userId), eq(s.photos.artworkId, artworkId)))
    .limit(1);
  return !!p;
}
