import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import type { DB } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { roundScore, scoreAt } from "@/lib/algo/scoring";
import { buildTaste, periodOf, topAbsolute, topNegative, topPositive } from "@/lib/algo/taste";
import { predictScore } from "@/lib/algo/predict";
import { masterpieceTerm, matchMuseums, type MatchTerm, type MuseumInput } from "@/lib/algo/match";
import { ARTWORK_ID_RE, TIERS, type ArtworkFeatures, type GenreRef, type MovementRef, type Tier } from "@/lib/algo/types";
import { commonsImage } from "@/lib/images";
import { ApiError } from "./errors";
import { hasPhotoOf, pendingArtworkIds, userPhotoMap } from "./visits";

/* ───────── Shared shapes ───────── */

export type ArtworkCard = {
  id: string;
  title: string;
  year: number | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  imageFile: string | null;
  artistId: string;
  artistName: string;
  movements: MovementRef[];
  genres: GenreRef[];
  museum: { id: string; name: string; city: string | null; country: string | null } | null;
  /** Hand-added by the user (not in Wikidata). */
  custom: boolean;
};

export type RankedItem = ArtworkCard & { tier: Tier; score: number; rank: number; tierIndex: number };

/** Fractional-index keys must compare bytewise, independent of DB collation. */
const byPosition = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/** With a userId, images become that user's own photo of the painting when they have one. */
async function loadCards(db: DB, ids: string[], userId: string | null = null): Promise<Map<string, ArtworkCard>> {
  const out = new Map<string, ArtworkCard>();
  if (!ids.length) return out;
  const rows = await db
    .select({
      id: s.artworks.id,
      title: s.artworks.title,
      year: s.artworks.year,
      imageFile: s.artworks.imageFile,
      artistId: s.artworks.artistId,
      artistName: sql<string>`coalesce(${s.artworks.artistLabel}, ${s.artists.name})`,
      ownerId: s.artworks.ownerId,
      museumId: s.museums.id,
      museumName: s.museums.name,
      city: s.museums.city,
      country: s.museums.country,
    })
    .from(s.artworks)
    .innerJoin(s.artists, eq(s.artists.id, s.artworks.artistId))
    .leftJoin(s.museums, eq(s.museums.id, s.artworks.museumId))
    .where(inArray(s.artworks.id, ids));
  const moves = await db
    .select({
      artworkId: s.artworkMovements.artworkId,
      id: s.movements.id,
      name: s.movements.name,
      source: s.artworkMovements.source,
    })
    .from(s.artworkMovements)
    .innerJoin(s.movements, eq(s.movements.id, s.artworkMovements.movementId))
    .where(inArray(s.artworkMovements.artworkId, ids));
  const gen = await db
    .select({ artworkId: s.artworkGenres.artworkId, id: s.genres.id, name: s.genres.name })
    .from(s.artworkGenres)
    .innerJoin(s.genres, eq(s.genres.id, s.artworkGenres.genreId))
    .where(inArray(s.artworkGenres.artworkId, ids));
  const gm = new Map<string, GenreRef[]>();
  for (const g of gen) gm.set(g.artworkId, [...(gm.get(g.artworkId) ?? []), { id: g.id, name: g.name }]);
  const mv = new Map<string, MovementRef[]>();
  for (const m of moves) {
    const l = mv.get(m.artworkId) ?? [];
    l.push({ id: m.id, name: m.name, source: m.source });
    mv.set(m.artworkId, l);
  }
  const photos = await userPhotoMap(db, userId, ids);
  for (const r of rows) {
    if (r.ownerId && r.ownerId !== userId) continue; // someone else's hand-added painting
    const mine = photos.get(r.id);
    out.set(r.id, {
      id: r.id,
      title: r.title,
      year: r.year,
      imageFile: r.imageFile,
      imageUrl: mine?.url ?? commonsImage(r.imageFile, 1000),
      thumbUrl: mine?.thumbUrl ?? commonsImage(r.imageFile, 240),
      custom: !!r.ownerId,
      artistId: r.artistId,
      artistName: r.artistName,
      movements: (mv.get(r.id) ?? []).sort((a, b) => (a.source === b.source ? 0 : a.source === "artwork" ? -1 : 1)),
      genres: gm.get(r.id) ?? [],
      museum: r.museumId ? { id: r.museumId, name: r.museumName!, city: r.city, country: r.country } : null,
    });
  }
  return out;
}

export const featuresOf = (c: ArtworkCard): ArtworkFeatures => ({
  artistId: c.artistId,
  movementIds: c.movements.map((m) => m.id),
  genreIds: c.genres.map((g) => g.id),
  year: c.year,
});

export async function getArtworkCard(db: DB, id: string, userId: string | null = null) {
  return (await loadCards(db, [id], userId)).get(id) ?? null;
}

/* ───────── Rankings ───────── */

async function tierRows(db: DB, userId: string, tier: Tier) {
  const rows = await db
    .select({ artworkId: s.rankings.artworkId, position: s.rankings.position })
    .from(s.rankings)
    .where(and(eq(s.rankings.userId, userId), eq(s.rankings.tier, tier)));
  return rows.sort(byPosition);
}

export async function getTierForSearch(db: DB, userId: string | null, tier: Tier) {
  if (!userId) return { tier, items: [] };
  const rows = await tierRows(db, userId, tier);
  const cards = await loadCards(db, rows.map((r) => r.artworkId), userId);
  return {
    tier,
    items: rows.map((r) => {
      const c = cards.get(r.artworkId)!;
      return { artworkId: r.artworkId, title: c.title, artistName: c.artistName, imageUrl: c.imageUrl };
    }),
  };
}

export async function getRankedList(db: DB, userId: string | null): Promise<Record<Tier, RankedItem[]>> {
  const out: Record<Tier, RankedItem[]> = { loved: [], fine: [], meh: [] };
  if (!userId) return out;
  const rows = await db
    .select({ artworkId: s.rankings.artworkId, tier: s.rankings.tier, position: s.rankings.position })
    .from(s.rankings)
    .where(eq(s.rankings.userId, userId));
  const cards = await loadCards(db, rows.map((r) => r.artworkId), userId);
  let rank = 0;
  for (const tier of TIERS) {
    const inTier = rows.filter((r) => r.tier === tier).sort(byPosition);
    out[tier] = inTier.map((r, i) => ({
      ...cards.get(r.artworkId)!,
      tier,
      tierIndex: i,
      rank: ++rank,
      score: roundScore(scoreAt(tier, i, inTier.length)),
    }));
  }
  return out;
}

export const insertRankingBody = z.object({
  artworkId: z.string().regex(ARTWORK_ID_RE),
  tier: z.enum(["loved", "fine", "meh"]),
  aboveId: z.string().regex(ARTWORK_ID_RE).nullable(),
  belowId: z.string().regex(ARTWORK_ID_RE).nullable(),
  comparisons: z
    .array(z.object({ winnerId: z.string(), loserId: z.string(), wasTie: z.boolean() }))
    .max(20),
});
export type InsertRankingBody = z.infer<typeof insertRankingBody>;

/** 6.1 step 5: verify the slot is still adjacent, then write ranking + comparisons atomically. */
export async function insertRanking(db: DB, userId: string, raw: unknown) {
  const body = insertRankingBody.parse(raw);
  const result = await db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [art] = await t
      .select({ id: s.artworks.id, ownerId: s.artworks.ownerId })
      .from(s.artworks)
      .where(eq(s.artworks.id, body.artworkId));
    if (!art || (art.ownerId && art.ownerId !== userId)) throw new ApiError(404, "not_found", "We couldn't find that painting.");
    if (!(await hasPhotoOf(t, userId, body.artworkId))) {
      throw new ApiError(403, "not_photographed", "Add a photo of this painting from a visit before ranking it.");
    }

    const [existing] = await t
      .select({ tier: s.rankings.tier })
      .from(s.rankings)
      .where(and(eq(s.rankings.userId, userId), eq(s.rankings.artworkId, body.artworkId)));
    if (existing) throw new ApiError(409, "already_ranked", "You've already ranked this painting.");

    const rows = await tierRows(t, userId, body.tier);
    const ids = rows.map((r) => r.artworkId);
    const inTier = new Set(ids);
    for (const c of body.comparisons) {
      const involves = c.winnerId === body.artworkId || c.loserId === body.artworkId;
      const other = c.winnerId === body.artworkId ? c.loserId : c.winnerId;
      if (!involves || !inTier.has(other)) {
        throw new ApiError(400, "bad_comparisons", "Those comparisons don't match this tier. Placing it again.");
      }
    }

    const ai = body.aboveId ? ids.indexOf(body.aboveId) : -1;
    const bi = body.belowId ? ids.indexOf(body.belowId) : ids.length;
    const adjacent =
      (body.aboveId === null || ai >= 0) &&
      (body.belowId === null || bi >= 0) &&
      bi === ai + 1;
    if (!adjacent) {
      throw new ApiError(409, "slot_moved", "Your ranking changed in another tab. Placing it again.");
    }

    const position = generateKeyBetween(rows[ai]?.position ?? null, rows[bi]?.position ?? null);
    await t.insert(s.rankings).values({ userId, artworkId: body.artworkId, tier: body.tier, position });
    if (body.comparisons.length) {
      await t.insert(s.comparisons).values(body.comparisons.map((c) => ({ ...c, userId })));
    }
    await t.delete(s.skips).where(and(eq(s.skips.userId, userId), eq(s.skips.artworkId, body.artworkId)));
    const index = ai + 1;
    const n = ids.length + 1;
    return { index, n };
  });
  return {
    ranking: { artworkId: body.artworkId, tier: body.tier, tierIndex: result.index, tierSize: result.n },
    score: roundScore(scoreAt(body.tier, result.index, result.n)),
  };
}

export async function deleteRanking(db: DB, userId: string, artworkId: string) {
  await db.delete(s.rankings).where(and(eq(s.rankings.userId, userId), eq(s.rankings.artworkId, artworkId)));
}

export async function addSkip(db: DB, userId: string, artworkId: string) {
  await db
    .insert(s.skips)
    .values({ userId, artworkId })
    .onConflictDoUpdate({ target: [s.skips.userId, s.skips.artworkId], set: { skippedAt: new Date() } });
}

/* ───────── Taste ───────── */

async function rankedForTaste(db: DB, userId: string | null) {
  const list = await getRankedList(db, userId);
  const all = [...list.loved, ...list.fine, ...list.meh];
  return {
    list,
    all,
    taste: buildTaste(
      all.map((r) => ({
        artworkId: r.id,
        artistId: r.artistId,
        artistName: r.artistName,
        score: r.score,
        movements: r.movements,
        genres: r.genres,
        year: r.year,
      })),
    ),
  };
}

export async function getTasteProfile(db: DB, userId: string | null) {
  const { all, taste } = await rankedForTaste(db, userId);
  const works = (pred: (r: RankedItem) => boolean) =>
    all.filter(pred).map((r) => ({ id: r.id, title: r.title, thumbUrl: r.thumbUrl, score: r.score }));
  const artists = topPositive(taste.artists, 5).map((a) => ({ ...a, works: works((r) => r.artistId === a.id) }));
  const movements = topPositive(taste.movements, 4).map((m) => ({
    ...m,
    works: works((r) => r.movements.some((x) => x.id === m.id)),
  }));
  const genres = topPositive(taste.genres, 4).map((g) => ({
    ...g,
    works: works((r) => r.genres.some((x) => x.id === g.id)),
  }));
  const periods = topPositive(taste.periods, 3).map((p) => ({
    ...p,
    works: works((r) => periodOf(r.year)?.id === p.id),
  }));
  // Only call something a dislike once it rests on 2+ paintings.
  const dislikes = [
    ...topNegative(taste.artists, 3).filter((a) => a.count >= 2).map((a) => ({ ...a, kind: "artist" as const })),
    ...topNegative(taste.movements, 3).filter((a) => a.count >= 2).map((a) => ({ ...a, kind: "movement" as const })),
    ...topNegative(taste.genres, 3).filter((a) => a.count >= 2).map((a) => ({ ...a, kind: "genre" as const })),
  ].sort((a, b) => a.affinity - b.affinity).slice(0, 5);
  return { artists, movements, genres, periods, dislikes, rankedCount: all.length };
}

/* ───────── What's left to rank ───────── */

/** Paintings the user photographed on a visit but hasn't ranked yet, as cards showing their photo. */
export async function getPending(db: DB, userId: string | null, opts: { visitId?: string; first?: string } = {}) {
  let ids = await pendingArtworkIds(db, userId, { visitId: opts.visitId });
  if (opts.first && ids.includes(opts.first)) ids = [opts.first, ...ids.filter((id) => id !== opts.first)];
  const cards = await loadCards(db, ids, userId);
  return ids.map((id) => cards.get(id)).filter((c): c is ArtworkCard => !!c);
}

/* ───────── Museums ───────── */

export const UNLOCK_AT = 5;

export type MuseumMatch = {
  museum: { id: string; name: string; city: string | null; country: string | null; lat: number | null; lon: number | null };
  matchPct: number;
  distanceKm: number | null;
  reasons: string[];
  topWorks: { id: string; title: string; artistName: string; thumbUrl: string | null; predicted: number; confidence: "low" | "normal" }[];
};

export async function getMuseumMatches(
  db: DB,
  userId: string | null,
  opts: { lat?: number | null; lon?: number | null; radiusKm?: number | null; includeVisited?: boolean; limit?: number },
): Promise<{ locked: null | { rankedCount: number; needed: number; reason: string }; matches: MuseumMatch[] }> {
  const { all, list, taste } = await rankedForTaste(db, userId);
  if (all.length < UNLOCK_AT || list.loved.length === 0) {
    const needed = Math.max(UNLOCK_AT - all.length, 0);
    return {
      locked: {
        rankedCount: all.length,
        needed,
        reason:
          needed > 0
            ? `Rank ${needed} more painting${needed === 1 ? "" : "s"} to see museum matches.`
            : "Put at least one painting in Loved it to see museum matches.",
      },
      matches: [],
    };
  }

  const artistIds = topAbsolute(taste.artists, 15).map((a) => a.id);
  const movementIds = topAbsolute(taste.movements, 6).map((m) => m.id);
  const ah = artistIds.length
    ? await db.select().from(s.museumArtistHoldings).where(inArray(s.museumArtistHoldings.artistId, artistIds))
    : [];
  const mh = movementIds.length
    ? await db.select().from(s.museumMovementHoldings).where(inArray(s.museumMovementHoldings.movementId, movementIds))
    : [];
  const museumIds = [...new Set([...ah.map((h) => h.museumId), ...mh.map((h) => h.museumId)])];
  if (!museumIds.length) return { locked: null, matches: [] };
  const museumRows = await db.select().from(s.museums).where(inArray(s.museums.id, museumIds));

  const exclude = new Set<string>();
  if (userId && !opts.includeVisited) {
    const marks = await db
      .select({ id: s.museumMarks.museumId })
      .from(s.museumMarks)
      .where(and(eq(s.museumMarks.userId, userId), eq(s.museumMarks.status, "visited")));
    for (const m of marks) exclude.add(m.id);
  }

  const inputs: MuseumInput[] = museumRows.map((m) => ({
    id: m.id,
    name: m.name,
    lat: m.lat,
    lon: m.lon,
    artistHoldings: ah.filter((h) => h.museumId === m.id).map((h) => ({ artistId: h.artistId, count: h.paintingCount })),
    movementHoldings: mh.filter((h) => h.museumId === m.id).map((h) => ({ movementId: h.movementId, count: h.paintingCount })),
  }));
  const origin = opts.lat != null && opts.lon != null ? { lat: opts.lat, lon: opts.lon } : null;
  const matchOpts = { origin, radiusKm: opts.radiusKm, excludeIds: exclude };
  const limit = opts.limit ?? 25;

  // Pass 1: holdings only. Pass 2: re-rank the top candidates with the
  // masterpiece term (specific works there you're predicted to love).
  const shortlist = matchMuseums(inputs, taste, matchOpts).filter((r) => r.raw > 0).slice(0, limit * 3);
  const ranked = new Set(all.map((r) => r.id));
  const works = await predictedWorksAt(db, shortlist.map((r) => r.id), taste, ranked);
  const extraTerms = new Map<string, MatchTerm[]>();
  for (const [museumId, ws] of works) {
    const t = masterpieceTerm(ws);
    if (t) extraTerms.set(museumId, [t]);
  }
  const keep = new Set(shortlist.map((r) => r.id));
  const results = matchMuseums(inputs.filter((m) => keep.has(m.id)), taste, { ...matchOpts, extraTerms })
    .filter((r) => r.raw > 0)
    .slice(0, limit);

  const byId = new Map(museumRows.map((m) => [m.id, m]));
  return {
    locked: null,
    matches: results.map((r) => {
      const m = byId.get(r.id)!;
      return {
        museum: { id: m.id, name: m.name, city: m.city, country: m.country, lat: m.lat, lon: m.lon },
        matchPct: r.matchPct,
        distanceKm: r.distanceKm == null ? null : Math.round(r.distanceKm),
        reasons: r.reasons,
        topWorks: (works.get(r.id) ?? []).slice(0, 3),
      };
    }),
  };
}

async function predictedWorksAt(
  db: DB,
  museumIds: string[],
  taste: ReturnType<typeof buildTaste>,
  exclude: Set<string>,
  onlyLiked = true,
) {
  const out = new Map<string, MuseumMatch["topWorks"]>();
  if (!museumIds.length) return out;
  // Only works touching a liked artist, movement or genre can predict high;
  // filtering in SQL keeps this fast as museums hold thousands of works.
  const likedArtists = topPositive(taste.artists, 50).map((a) => a.id);
  const likedMoves = topPositive(taste.movements, 20).map((m) => m.id);
  const likedGenres = topPositive(taste.genres, 20).map((g) => g.id);
  const touches = [
    likedArtists.length ? inArray(s.artworks.artistId, likedArtists) : undefined,
    likedMoves.length
      ? sql`exists (select 1 from artwork_movements am where am.artwork_id = ${s.artworks.id} and am.movement_id in ${likedMoves})`
      : undefined,
    likedGenres.length
      ? sql`exists (select 1 from artwork_genres ag where ag.artwork_id = ${s.artworks.id} and ag.genre_id in ${likedGenres})`
      : undefined,
  ].filter(Boolean);
  if (onlyLiked && !touches.length) return out;
  const where = and(inArray(s.artworks.museumId, museumIds), onlyLiked ? or(...touches) : undefined);

  // Lean feature load in one query: movement and genre ids come back as arrays.
  const rows = await db
    .select({
      id: s.artworks.id,
      title: s.artworks.title,
      year: s.artworks.year,
      imageFile: s.artworks.imageFile,
      museumId: s.artworks.museumId,
      artistId: s.artworks.artistId,
      artistName: s.artists.name,
      movementIds: sql<string[] | null>`(select array_agg(am.movement_id) from artwork_movements am where am.artwork_id = ${s.artworks.id})`,
      genreIds: sql<string[] | null>`(select array_agg(ag.genre_id) from artwork_genres ag where ag.artwork_id = ${s.artworks.id})`,
    })
    .from(s.artworks)
    .innerJoin(s.artists, eq(s.artists.id, s.artworks.artistId))
    .where(where);
  const moves = new Map(rows.map((r) => [r.id, r.movementIds ?? []]));
  const gens = new Map(rows.map((r) => [r.id, r.genreIds ?? []]));

  for (const r of rows) {
    if (exclude.has(r.id) || !r.museumId) continue;
    const p = predictScore(
      { artistId: r.artistId, movementIds: moves.get(r.id) ?? [], genreIds: gens.get(r.id) ?? [], year: r.year },
      taste,
    );
    const list = out.get(r.museumId) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      artistName: r.artistName,
      thumbUrl: commonsImage(r.imageFile, 240),
      predicted: roundScore(p.score),
      confidence: p.confidence,
    });
    out.set(r.museumId, list);
  }
  for (const l of out.values()) l.sort((a, b) => b.predicted - a.predicted);
  return out;
}

export async function getMuseumDetail(db: DB, userId: string | null, id: string) {
  const [museum] = await db.select().from(s.museums).where(eq(s.museums.id, id));
  if (!museum) return null;
  const { all, taste } = await rankedForTaste(db, userId);
  const rankedScores = new Map(all.filter((r) => r.museum?.id === id).map((r) => [r.id, r.score]));
  const works = (await predictedWorksAt(db, [id], taste, new Set(), false)).get(id) ?? [];
  const holdings = await db
    .select({ artistId: s.museumArtistHoldings.artistId, name: s.artists.name, count: s.museumArtistHoldings.paintingCount })
    .from(s.museumArtistHoldings)
    .innerJoin(s.artists, eq(s.artists.id, s.museumArtistHoldings.artistId))
    .where(eq(s.museumArtistHoldings.museumId, id))
    .orderBy(desc(s.museumArtistHoldings.paintingCount))
    .limit(12);
  let mark: "visited" | "want" | null = null;
  if (userId) {
    const [m] = await db
      .select({ status: s.museumMarks.status })
      .from(s.museumMarks)
      .where(and(eq(s.museumMarks.userId, userId), eq(s.museumMarks.museumId, id)));
    mark = m?.status ?? null;
  }
  return {
    museum,
    mark,
    holdings,
    works: works.map((w) => ({
      ...w,
      myScore: rankedScores.get(w.id) ?? null,
    })),
  };
}

export async function setMuseumMark(db: DB, userId: string, museumId: string, status: "visited" | "want" | null) {
  if (status === null) {
    await db.delete(s.museumMarks).where(and(eq(s.museumMarks.userId, userId), eq(s.museumMarks.museumId, museumId)));
    return;
  }
  await db
    .insert(s.museumMarks)
    .values({ userId, museumId, status })
    .onConflictDoUpdate({ target: [s.museumMarks.userId, s.museumMarks.museumId], set: { status } });
}

/* ───────── Artwork page ───────── */

export async function getArtworkPage(db: DB, userId: string | null, id: string) {
  const card = await getArtworkCard(db, id, userId);
  if (!card) return null;
  const { all, taste } = await rankedForTaste(db, userId);
  const mine = all.find((r) => r.id === id) ?? null;
  const prediction = mine ? null : predictScore(featuresOf(card), taste);
  return {
    card,
    photographed: userId ? await hasPhotoOf(db, userId, id) : false,
    mine: mine ? { score: mine.score, tier: mine.tier, rank: mine.rank } : null,
    prediction: prediction ? { score: roundScore(prediction.score), confidence: prediction.confidence } : null,
  };
}

/** Landing page hero rotation: most famous pool paintings. */
export async function getHeroPaintings(db: DB, n = 8) {
  const rows = await db
    .select({ id: s.artworks.id })
    .from(s.artworks)
    .where(
      and(
        eq(s.artworks.inPool, true),
        sql`${s.artworks.imageFile} is not null`,
        // The landing page is the first thing anyone sees: no nudes or erotic art.
        sql`not exists (select 1 from artwork_genres ag join genres g on g.id = ag.genre_id
          where ag.artwork_id = ${s.artworks.id} and g.name ~* '(nude|erotic)')`,
      ),
    )
    .orderBy(desc(s.artworks.fame), desc(s.artworks.sitelinks))
    .limit(n);
  const cards = await loadCards(db, rows.map((r) => r.id));
  return rows.map((r) => cards.get(r.id)!);
}

/* ───────── Guest → account merge ───────── */

/**
 * Move a guest's data onto an account. Paintings the account already ranked
 * keep the account's placement; the rest are appended to the bottom of their tier.
 */
export async function mergeGuestInto(db: DB, guestId: string, accountId: string) {
  if (guestId === accountId) return;
  await db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const guest = await t.select().from(s.rankings).where(eq(s.rankings.userId, guestId));
    const mine = new Set(
      (await t.select({ id: s.rankings.artworkId }).from(s.rankings).where(eq(s.rankings.userId, accountId))).map((r) => r.id),
    );
    for (const tier of TIERS) {
      const rows = guest.filter((g) => g.tier === tier && !mine.has(g.artworkId)).sort(byPosition);
      let last = (await tierRows(t, accountId, tier)).at(-1)?.position ?? null;
      for (const r of rows) {
        last = generateKeyBetween(last, null);
        await t.insert(s.rankings).values({ userId: accountId, artworkId: r.artworkId, tier, position: last });
      }
    }
    await t.update(s.comparisons).set({ userId: accountId }).where(eq(s.comparisons.userId, guestId));
    await t.execute(sql`insert into skips (user_id, artwork_id, skipped_at)
      select ${accountId}, artwork_id, skipped_at from skips where user_id = ${guestId}
      on conflict do nothing`);
    await t.execute(sql`insert into museum_marks (user_id, museum_id, status)
      select ${accountId}, museum_id, status from museum_marks where user_id = ${guestId}
      on conflict do nothing`);
    // Visits, photos and hand-added paintings move wholesale (they'd cascade away with the guest).
    await t.update(s.artworks).set({ ownerId: accountId }).where(eq(s.artworks.ownerId, guestId));
    await t.update(s.visits).set({ userId: accountId }).where(eq(s.visits.userId, guestId));
    await t.update(s.photos).set({ userId: accountId }).where(eq(s.photos.userId, guestId));
    await t.delete(s.users).where(eq(s.users.id, guestId));
  });
}

