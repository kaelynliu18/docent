import { PREDICT_SCALE, PREDICT_WEIGHTS, TERM_NAMES, predictionTerms, type Weights } from "./predict";
import { buildTaste } from "./taste";
import type { RankedForTaste } from "./types";

/** Below this many rankings the defaults are used unchanged. */
export const PERSONAL_MIN_RANKINGS = 20;
/** Pull toward the defaults, in rankings' worth: more rankings, more freedom. */
export const PERSONAL_RIDGE = 8;
/** Leave-one-out costs a taste rebuild per painting, so fit on the most recent ones. */
export const PERSONAL_MAX_FIT = 150;

/** Solves A·x = b for a small dense system (Gaussian elimination, partial pivoting). */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Weights fitted to one person's own rankings, so a person who follows colour
 * and mood more than artists gets predictions that reflect that.
 *
 * For each ranked painting: rebuild taste without it (so it can't predict
 * itself), read its trait affinities x, and turn its real score into the z it
 * implies (inverse of ŝ = 5 + 5·tanh(0.6·z)). Then ridge regression toward the
 * defaults: minimise Σ(z − x·β)² + λ·Σ(β − β₀)², with no negative weights.
 */
export function learnWeights(ranked: RankedForTaste[], prior: Weights = PREDICT_WEIGHTS): Weights {
  if (ranked.length < PERSONAL_MIN_RANKINGS) return prior;
  const fit = ranked.slice(-PERSONAL_MAX_FIT);
  const d = TERM_NAMES.length;
  const XtX = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const Xty = new Array<number>(d).fill(0);
  for (let i = 0; i < fit.length; i++) {
    const r = fit[i];
    const taste = buildTaste(ranked.filter((x) => x.artworkId !== r.artworkId));
    const t = predictionTerms(
      {
        artistId: r.artistId,
        movementIds: r.movements.map((m) => m.id),
        genreIds: (r.genres ?? []).map((g) => g.id),
        year: r.year,
        tags: r.tags,
        looks: r.looks,
        moods: r.moods,
      },
      taste,
    );
    const x = TERM_NAMES.map((n) => t[n]);
    const z = Math.atanh(Math.max(-0.98, Math.min(0.98, (r.score - 5) / 5))) / PREDICT_SCALE;
    for (let a = 0; a < d; a++) {
      Xty[a] += x[a] * z;
      for (let b = 0; b < d; b++) XtX[a][b] += x[a] * x[b];
    }
  }
  const beta0 = TERM_NAMES.map((n) => prior[n]);
  const A = XtX.map((row, a) => row.map((v, b) => v + (a === b ? PERSONAL_RIDGE : 0)));
  const b = Xty.map((v, a) => v + PERSONAL_RIDGE * beta0[a]);
  const beta = solve(A, b);
  if (!beta) return prior;
  return Object.fromEntries(TERM_NAMES.map((n, i) => [n, Math.max(0, Math.round(beta[i] * 1000) / 1000)])) as Weights;
}
