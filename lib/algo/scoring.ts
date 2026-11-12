import type { Tier } from "./types";

/** 6.2 Each tier owns a score band. */
export const BANDS: Record<Tier, { min: number; max: number }> = {
  loved: { min: 6.8, max: 10.0 },
  fine: { min: 3.4, max: 6.8 },
  meh: { min: 0.0, max: 3.4 },
};

/**
 * Score for the item at 0-based position i in a tier of n items.
 * Raw scores spread evenly over the band, then shrink toward the band's
 * midpoint by n / (n + 2) so a tiny tier can't produce extreme scores.
 */
export function scoreAt(tier: Tier, i: number, n: number): number {
  if (n <= 0 || i < 0 || i >= n) throw new RangeError(`bad position ${i} of ${n}`);
  const { min, max } = BANDS[tier];
  const mid = (min + max) / 2;
  const raw = n === 1 ? mid : max - (i / (n - 1)) * (max - min);
  return mid + (raw - mid) * (n / (n + 2));
}

export function roundScore(s: number): number {
  return Math.round(s * 10) / 10;
}

/** Scores for a whole tier, already ordered best-first. */
export function scoreTier(tier: Tier, n: number): number[] {
  return Array.from({ length: n }, (_, i) => scoreAt(tier, i, n));
}
