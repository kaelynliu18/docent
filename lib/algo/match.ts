import { topAbsolute } from "./taste";
import type { TasteProfile } from "./types";

export type MuseumInput = {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  artistHoldings: { artistId: string; count: number }[];
  movementHoldings: { movementId: string; count: number }[];
};

export type MatchOptions = {
  origin?: { lat: number; lon: number } | null;
  radiusKm?: number | null;
  excludeIds?: Set<string>;
  topArtists?: number;
  topMovements?: number;
  /** Additional per-museum terms (e.g. masterpieceTerm), added before the distance discount. */
  extraTerms?: Map<string, MatchTerm[]>;
};

export type MuseumMatchResult = {
  id: string;
  raw: number;
  matchPct: number;
  distanceKm: number | null;
  reasons: string[];
};

/** hidden terms count toward the score but aren't listed in the "Holds…" reasons. */
export type MatchTerm = { value: number; text: string; hidden?: boolean };

export const MOVEMENT_WEIGHT = 0.4;
export const MASTERPIECE_WEIGHT = 0.5;
export const MASTERPIECE_TOP = 5;

/**
 * Holdings counts say "lots of Monets"; this term says "and these specific
 * works you'd love hang there". Uses the top-5 confident predictions above 6.5.
 */
export function masterpieceTerm(
  works: { title: string; predicted: number; confidence: "low" | "normal" }[],
): MatchTerm | null {
  const good = works
    .filter((w) => w.confidence === "normal" && w.predicted > 6.5)
    .sort((a, b) => b.predicted - a.predicted)
    .slice(0, MASTERPIECE_TOP);
  if (!good.length) return null;
  const value = MASTERPIECE_WEIGHT * good.reduce((s, w) => s + (w.predicted - 5) / 5, 0);
  return { value, text: `${good[0].title} (predicted ${good[0].predicted.toFixed(1)})`, hidden: true };
}

export const DISTANCE_SCALE_KM = 50;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * 6.5 match_u = (Σ_k A_k ln(1+h) + 0.4 Σ_m M_m ln(1+g)) / (1 + d/50km).
 * Only the top 15 artists and 6 movements by |affinity| count.
 * Returns every museum that passes the filters, best first; callers decide
 * whether to hide non-positive matches.
 */
export function matchMuseums(
  museums: MuseumInput[],
  taste: TasteProfile,
  opts: MatchOptions = {},
): MuseumMatchResult[] {
  const artists = new Map(topAbsolute(taste.artists, opts.topArtists ?? 15).map((a) => [a.id, a]));
  const movements = new Map(
    topAbsolute(taste.movements, opts.topMovements ?? 6).map((m) => [m.id, m]),
  );
  const origin = opts.origin ?? null;

  const results: MuseumMatchResult[] = [];
  for (const m of museums) {
    if (opts.excludeIds?.has(m.id)) continue;

    let distanceKm: number | null = null;
    if (origin) {
      if (m.lat == null || m.lon == null) continue;
      distanceKm = haversineKm(origin, { lat: m.lat, lon: m.lon });
      if (opts.radiusKm != null && distanceKm > opts.radiusKm) continue;
    }

    const terms: MatchTerm[] = [];
    for (const h of m.artistHoldings) {
      const a = artists.get(h.artistId);
      if (!a || h.count <= 0) continue;
      terms.push({ value: a.affinity * Math.log1p(h.count), text: `${h.count} by ${a.name}` });
    }
    for (const g of m.movementHoldings) {
      const mv = movements.get(g.movementId);
      if (!mv || g.count <= 0) continue;
      terms.push({
        value: MOVEMENT_WEIGHT * mv.affinity * Math.log1p(g.count),
        text: `${g.count} ${mv.name} works`,
      });
    }

    for (const t of opts.extraTerms?.get(m.id) ?? []) terms.push(t);
    const sum = terms.reduce((s, t) => s + t.value, 0);
    const distFactor = distanceKm == null ? 1 : 1 / (1 + distanceKm / DISTANCE_SCALE_KM);
    const reasons = terms
      .filter((t) => t.value > 0 && !t.hidden)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map((t) => t.text);
    results.push({ id: m.id, raw: sum * distFactor, matchPct: 0, distanceKm, reasons });
  }

  results.sort((a, b) => b.raw - a.raw);
  const top = results[0]?.raw ?? 0;
  for (const r of results) {
    r.matchPct = top > 0 ? Math.max(0, Math.round((r.raw / top) * 100)) : 0;
  }
  return results;
}
