import { predictScore } from "./predict";
import type { TasteProfile } from "./types";

export type QueueCandidate = {
  id: string;
  artistId: string;
  sitelinks: number;
  /** 0–1 recognisability (pageviews + sitelinks). Falls back to sitelinks when absent. */
  fame?: number;
  movementIds: string[];
  genreIds?: string[];
  year?: number | null;
};

export type QueueContext = {
  rankedCount: number;
  taste: TasteProfile;
  /** Artist of the painting the user saw last, so we never repeat it. */
  lastArtistId?: string | null;
  limit: number;
  rng?: () => number;
};

export const PERSONALIZE_AFTER = 10;
/** Share of picks per strategy once personalised. */
export const MIX = { exploit: 0.6, explore: 0.25, sharpen: 0.15 };

const fameOf = (c: QueueCandidate) => c.fame ?? Math.min(1, Math.log1p(c.sitelinks) / Math.log1p(100));

/**
 * 6.6 What to rank next. Candidates must already exclude ranked and
 * recently skipped paintings (the DB query does that).
 */
export function pickQueue(candidates: QueueCandidate[], ctx: QueueContext): string[] {
  const rng = ctx.rng ?? Math.random;
  const ordered =
    ctx.rankedCount < PERSONALIZE_AFTER
      ? coldStart(candidates)
      : personalized(candidates, ctx.taste, rng, ctx.limit);
  return noRepeatArtist(ordered, ctx.lastArtistId ?? null, ctx.limit).map((c) => c.id);
}

/**
 * Before 10 rankings: the most recognisable paintings, round-robin across
 * movements, and each artist at most once until every artist has had a turn,
 * so the first ten rankings span as much taste space as possible.
 */
function coldStart(cands: QueueCandidate[]): QueueCandidate[] {
  const byMove = new Map<string, QueueCandidate[]>();
  for (const c of [...cands].sort((a, b) => fameOf(b) - fameOf(a))) {
    const key = c.movementIds[0] ?? "none";
    const list = byMove.get(key) ?? [];
    list.push(c);
    byMove.set(key, list);
  }
  const lists = [...byMove.values()].sort((a, b) => fameOf(b[0]) - fameOf(a[0]));
  const interleaved: QueueCandidate[] = [];
  for (let round = 0; interleaved.length < cands.length; round++) {
    for (const l of lists) if (l[round]) interleaved.push(l[round]);
  }
  const usedArtists = new Set<string>();
  const first: QueueCandidate[] = [];
  const later: QueueCandidate[] = [];
  for (const c of interleaved) {
    if (usedArtists.has(c.artistId)) later.push(c);
    else {
      usedArtists.add(c.artistId);
      first.push(c);
    }
  }
  return [...first, ...later];
}

/**
 * After 10 rankings, three strategies:
 * - exploit (60%): sample ∝ e^(ŝ/2) × (0.5 + fame), likely loves that people recognise
 * - explore (25%): movements or genres the user hasn't ranked yet
 * - sharpen (15%): artists/movements ranked exactly once, where one more
 *   data point changes the profile the most
 */
function personalized(
  cands: QueueCandidate[],
  taste: TasteProfile,
  rng: () => number,
  limit: number,
): QueueCandidate[] {
  const unseen = cands.filter(
    (c) =>
      (c.movementIds.length > 0 && c.movementIds.every((m) => !taste.movements.has(m))) ||
      ((c.genreIds?.length ?? 0) > 0 && c.genreIds!.every((g) => !taste.genres.has(g))),
  );
  const once = (m: Map<string, { count: number }>, id: string) => m.get(id)?.count === 1;
  const sharpen = cands.filter(
    (c) => once(taste.artists, c.artistId) || c.movementIds.some((m) => once(taste.movements, m)),
  );
  const weighted = cands.map((c) => ({
    c,
    w: Math.exp(predictScore(c, taste).score / 2) * (0.5 + fameOf(c)),
  }));

  const out: QueueCandidate[] = [];
  const used = new Set<string>();
  const want = Math.min(cands.length, limit * 2); // slack for the no-repeat filter
  while (out.length < want) {
    const r = rng();
    const pool =
      r < MIX.exploit ? null : r < MIX.exploit + MIX.explore ? unseen : sharpen;
    const open = pool?.filter((c) => !used.has(c.id));
    const pick = open?.length
      ? sampleWeighted(open.map((c) => ({ c, w: 0.5 + fameOf(c) })), rng)
      : sampleWeighted(weighted.filter((x) => !used.has(x.c.id)), rng);
    if (!pick) break;
    used.add(pick.id);
    out.push(pick);
  }
  return out;
}

function sampleWeighted(xs: { c: QueueCandidate; w: number }[], rng: () => number) {
  const total = xs.reduce((s, x) => s + x.w, 0);
  let r = rng() * total;
  for (const x of xs) {
    r -= x.w;
    if (r <= 0) return x.c;
  }
  return xs[xs.length - 1]?.c;
}

/** Greedy reorder so no two consecutive paintings share an artist. */
export function noRepeatArtist(
  xs: QueueCandidate[],
  lastArtistId: string | null,
  limit: number,
): QueueCandidate[] {
  const pending = [...xs];
  const out: QueueCandidate[] = [];
  let prev = lastArtistId;
  while (out.length < limit && pending.length) {
    const i = pending.findIndex((c) => c.artistId !== prev);
    if (i === -1) break;
    const [c] = pending.splice(i, 1);
    out.push(c);
    prev = c.artistId;
  }
  return out;
}
