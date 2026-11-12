import { scoreAt } from "./scoring";
import { buildTaste, periodOf } from "./taste";
import { PREDICT_WEIGHTS, predictScore } from "./predict";
import { TIERS, type RankedForTaste, type Tier } from "./types";

/**
 * Offline evaluation with simulated users. Each user has hidden preferences
 * per artist, movement, genre and century; their reaction to a painting is
 * the weighted sum plus noise. They rank `train` paintings into tiers, and we
 * measure how well a predictor orders `test` paintings they haven't ranked
 * (Spearman rank correlation with the hidden reaction). The ground-truth
 * weights are an assumption; the point is comparing predictors fairly.
 */
export type EvalItem = {
  id: string;
  artistId: string;
  artistName: string;
  movementIds: string[];
  genreIds: string[];
  year: number | null;
};

export type TruthWeights = { artist: number; movement: number; genre: number; period: number; noise: number };
export const DEFAULT_TRUTH: TruthWeights = { artist: 1, movement: 0.6, genre: 0.6, period: 0.3, noise: 0.5 };

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function evaluatePredictors(
  items: EvalItem[],
  predictors: Record<string, typeof PREDICT_WEIGHTS>,
  opts: { users?: number; train?: number; test?: number; seed?: number; truth?: TruthWeights } = {},
): Record<string, { spearman: number; top10Hit: number }> {
  const { users = 200, train = 25, test = 300, seed = 1, truth = DEFAULT_TRUTH } = opts;
  const rng = mulberry32(seed);
  const totals = Object.fromEntries(Object.keys(predictors).map((k) => [k, { spearman: 0, top10Hit: 0 }]));

  for (let u = 0; u < users; u++) {
    const prefs = new Map<string, number>();
    const pref = (key: string) => {
      if (!prefs.has(key)) prefs.set(key, gaussian(rng));
      return prefs.get(key)!;
    };
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    const utility = (it: EvalItem) =>
      truth.artist * pref(`a:${it.artistId}`) +
      truth.movement * mean(it.movementIds.map((m) => pref(`m:${m}`))) +
      truth.genre * mean(it.genreIds.map((g) => pref(`g:${g}`))) +
      truth.period * (periodOf(it.year) ? pref(`p:${periodOf(it.year)!.id}`) : 0) +
      truth.noise * gaussian(rng);

    // Sample without replacement.
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const trainSet = shuffled.slice(0, train).map((it) => ({ it, u: utility(it) }));
    const testSet = shuffled.slice(train, train + test).map((it) => ({ it, u: utility(it) }));

    // Tiers by tercile of the user's own reactions, ordered within tier.
    const sorted = [...trainSet].sort((a, b) => b.u - a.u);
    const cut = [Math.round(train * 0.35), Math.round(train * 0.7)];
    const ranked: RankedForTaste[] = [];
    TIERS.forEach((tier: Tier, ti) => {
      const inTier = sorted.slice(ti === 0 ? 0 : cut[ti - 1], ti === 2 ? train : cut[ti]);
      inTier.forEach(({ it }, i) =>
        ranked.push({
          artworkId: it.id,
          artistId: it.artistId,
          artistName: it.artistName,
          score: scoreAt(tier, i, inTier.length),
          movements: it.movementIds.map((id) => ({ id, name: id, source: "artwork" as const })),
          genres: it.genreIds.map((id) => ({ id, name: id })),
          year: it.year,
        }),
      );
    });
    const taste = buildTaste(ranked);
    const truthTop = new Set([...testSet].sort((a, b) => b.u - a.u).slice(0, 10).map((x) => x.it.id));

    for (const [name, w] of Object.entries(predictors)) {
      const preds = testSet.map(({ it }) => predictScore(it, taste, w).score);
      totals[name].spearman += spearman(preds, testSet.map((x) => x.u));
      const top = testSet
        .map((x, i) => ({ id: x.it.id, p: preds[i] }))
        .sort((a, b) => b.p - a.p)
        .slice(0, 10);
      totals[name].top10Hit += top.filter((x) => truthTop.has(x.id)).length / 10;
    }
  }
  for (const k of Object.keys(totals)) {
    totals[k].spearman /= users;
    totals[k].top10Hit /= users;
  }
  return totals;
}

export const BASELINE_WEIGHTS = { artist: 1, movement: 0.5, genre: 0, period: 0 };
export { PREDICT_WEIGHTS };
