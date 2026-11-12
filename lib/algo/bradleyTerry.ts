import { BANDS, scoreAt } from "./scoring";
import type { Tier } from "./types";
import type { Comparison } from "./insertion";

/**
 * Bradley–Terry strengths for one tier, from the comparisons a person made
 * while placing paintings (wins, losses, ties as half a win each way).
 * MAP estimate with a Gaussian prior (ridge λ) so it stays finite when every
 * answer is consistent, plus weak "list order" pseudo-comparisons between
 * neighbours so paintings that were never compared directly stay ordered.
 * Pure; returns strengths aligned with `order` (best first).
 */
export function fitStrengths(
  order: string[],
  comparisons: Comparison[],
  opts: { lambda?: number; adjacentWeight?: number; iterations?: number } = {},
): number[] {
  const { lambda = 0.5, adjacentWeight = 0.5, iterations = 300 } = opts;
  const n = order.length;
  if (n === 0) return [];
  const idx = new Map(order.map((id, i) => [id, i]));
  // (winner, loser, weight) triples
  const games: [number, number, number][] = [];
  for (const c of comparisons) {
    const w = idx.get(c.winnerId);
    const l = idx.get(c.loserId);
    if (w === undefined || l === undefined || w === l) continue;
    if (c.wasTie) {
      games.push([w, l, 0.5], [l, w, 0.5]);
    } else games.push([w, l, 1]);
  }
  for (let i = 0; i + 1 < n; i++) games.push([i, i + 1, adjacentWeight]);

  const theta = new Array<number>(n).fill(0);
  const grad = new Array<number>(n);
  // Newton-free gradient ascent; the problem is small (n ≲ 100) and strictly concave.
  const step = 1 / (lambda + 0.25 * maxDegree(games, n) + 1e-9);
  for (let t = 0; t < iterations; t++) {
    for (let i = 0; i < n; i++) grad[i] = -lambda * theta[i];
    for (const [w, l, wt] of games) {
      const p = 1 / (1 + Math.exp(theta[w] - theta[l])); // P(loser beats winner)
      grad[w] += wt * p;
      grad[l] -= wt * p;
    }
    let moved = 0;
    for (let i = 0; i < n; i++) {
      theta[i] += step * grad[i];
      moved = Math.max(moved, Math.abs(step * grad[i]));
    }
    if (moved < 1e-7) break;
  }
  return theta;
}

function maxDegree(games: [number, number, number][], n: number) {
  const d = new Array<number>(n).fill(0);
  for (const [w, l, wt] of games) {
    d[w] += wt;
    d[l] += wt;
  }
  return Math.max(1, ...d);
}

/** Pool-adjacent-violators: the closest non-increasing sequence (least squares). */
export function isotonicNonIncreasing(xs: number[]): number[] {
  const blocks: { sum: number; n: number }[] = [];
  for (const x of xs) {
    blocks.push({ sum: x, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n >= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, n: a.n + b.n });
    }
  }
  return blocks.flatMap((b) => Array<number>(b.n).fill(b.sum / b.n));
}

/**
 * Scores for a tier where spacing follows how decisive the choices were:
 * fit strengths, force them to agree with the list order, then map the
 * strongest/weakest onto the tier band (with the same small-tier shrinkage
 * as scoreAt). Equal strengths fall back to even spacing.
 */
export function btTierScores(tier: Tier, order: string[], comparisons: Comparison[], opts?: Parameters<typeof fitStrengths>[2]) {
  const n = order.length;
  const { min, max } = BANDS[tier];
  const mid = (min + max) / 2;
  if (n === 0) return [];
  if (n === 1) return [mid];
  const theta = isotonicNonIncreasing(fitStrengths(order, comparisons, opts));
  const hi = theta[0];
  const lo = theta[n - 1];
  const shrink = n / (n + 2);
  return theta.map((t, i) => {
    const frac = hi - lo > 1e-9 ? (t - lo) / (hi - lo) : 1 - i / (n - 1);
    const raw = min + frac * (max - min);
    return mid + (raw - mid) * shrink;
  });
}

/**
 * What ships: half Bradley–Terry spacing, half even (shrunk) spacing. In
 * simulation this was never worse than even spacing and up to ~3% closer to
 * people's true scores when their answers are inconsistent (docs/decisions.md).
 * Still strictly ordered by the list and inside the tier band.
 */
export function blendedTierScores(tier: Tier, order: string[], comparisons: Comparison[]): number[] {
  const n = order.length;
  const bt = btTierScores(tier, order, comparisons);
  return bt.map((x, i) => (x + scoreAt(tier, i, n)) / 2);
}
