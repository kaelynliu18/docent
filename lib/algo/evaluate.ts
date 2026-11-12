import { scoreAt } from "./scoring";
import { buildTaste, periodOf } from "./taste";
import { PREDICT_WEIGHTS, predictScore, type Weights } from "./predict";
import { learnWeights } from "./personal";
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
  /** Colour tags (lookTags). */
  looks?: string[];
  /** Mood tags. */
  moods?: string[];
};

/**
 * How much each hidden taste drives a simulated person's reaction.
 * look/mood: tastes for colour tags and moods. phase: an extra liking per
 * artist per 8-year stretch of their career (artists change), on top of the
 * liking for the artist overall.
 */
export type TruthWeights = {
  artist: number;
  movement: number;
  genre: number;
  period: number;
  noise: number;
  look?: number;
  mood?: number;
  phase?: number;
};
export const DEFAULT_TRUTH: TruthWeights = { artist: 1, movement: 0.6, genre: 0.6, period: 0.3, noise: 0.5 };

const meanNum = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** A person's hidden reaction to a painting, before noise. */
function utilityOf(it: EvalItem, truth: TruthWeights, pref: (key: string) => number): number {
  const p = periodOf(it.year);
  return (
    truth.artist * pref(`a:${it.artistId}`) +
    truth.movement * meanNum(it.movementIds.map((m) => pref(`m:${m}`))) +
    truth.genre * meanNum(it.genreIds.map((g) => pref(`g:${g}`))) +
    truth.period * (p ? pref(`p:${p.id}`) : 0) +
    // Only draw tastes that matter, so runs without them reproduce earlier numbers exactly.
    (truth.look ? truth.look * meanNum((it.looks ?? []).map((t) => pref(`l:${t}`))) : 0) +
    (truth.mood ? truth.mood * meanNum((it.moods ?? []).map((t) => pref(`o:${t}`))) : 0) +
    (truth.phase && it.year != null ? truth.phase * pref(`ap:${it.artistId}:${Math.floor(it.year / 8)}`) : 0)
  );
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number) {
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

/**
 * A simulated person: hidden preferences per artist/movement/genre/century, and
 * a stable reaction to each painting (the weighted sum plus per-painting noise).
 */
export function makeUser(rng: () => number, truth: TruthWeights = DEFAULT_TRUTH) {
  const prefs = new Map<string, number>();
  const pref = (key: string) => {
    if (!prefs.has(key)) prefs.set(key, gaussian(rng));
    return prefs.get(key)!;
  };
  const memo = new Map<string, number>();
  return (it: EvalItem) => {
    if (!memo.has(it.id)) memo.set(it.id, utilityOf(it, truth, pref) + truth.noise * gaussian(rng));
    return memo.get(it.id)!;
  };
}

export function shuffle<T>(xs: T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function evaluatePredictors(
  items: EvalItem[],
  /**
   * Fixed weights, or "personal" to fit weights to each simulated person's own
   * rankings. `{ weights, phase: false }` ignores when in a career a painting
   * was made (the pre-v3 behaviour).
   */
  predictors: Record<string, Partial<Weights> | "personal" | { weights: Partial<Weights> | "personal"; phase: boolean }>,
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
    const utility = (it: EvalItem) => utilityOf(it, truth, pref) + truth.noise * gaussian(rng);

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
          looks: it.looks,
          moods: it.moods,
        }),
      );
    });
    const taste = buildTaste(ranked);
    let personal: Weights | null = null;
    const truthTop = new Set([...testSet].sort((a, b) => b.u - a.u).slice(0, 10).map((x) => x.it.id));

    const noPhase = { ...taste, artistWorks: new Map() };
    for (const [name, spec] of Object.entries(predictors)) {
      const { weights, phase } = typeof spec === "object" && "phase" in spec ? spec : { weights: spec, phase: true };
      const w = weights === "personal" ? (personal ??= learnWeights(ranked)) : weights;
      const t = phase ? taste : noPhase;
      const preds = testSet.map(({ it }) => predictScore(it, t, w).score);
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

export const BASELINE_WEIGHTS = { artist: 1, movement: 0.5, genre: 0, period: 0, content: 0 };
export { PREDICT_WEIGHTS };

/**
 * Population test for collaborative filtering. Everyone belongs to one of
 * `clusters` taste groups; on top of their personal artist/movement/genre
 * tastes (makeUser), each group shares an extra liking per painting that
 * content features can't see (weight `shared`). People rank `train` paintings,
 * drawn with probability ∝ 0.1 + fame (famous works are seen more). For up to
 * `evalUsers` people we predict `test` unseen paintings and report Spearman
 * with their hidden reaction: content-only vs content blended with CF.
 */
export function evaluateCf(
  items: (EvalItem & { fame: number })[],
  opts: { population: number; clusters?: number; shared?: number; train?: number; test?: number; evalUsers?: number; seed?: number },
  blend: (content: number, cf: ReturnType<typeof import("./cf").cfPredict>, personWeight: number | null) => number,
  cfPredict: (mine: Map<string, number>, target: string) => ReturnType<typeof import("./cf").cfPredict>,
  setRatings: (r: Map<string, Map<string, number>>) => void,
  /** Optional per-person CF weight from their own rankings (null = fixed blend). */
  personWeight?: (mine: Map<string, number>, contentLoo: (heldOut: string) => number, personId: string) => number,
) {
  const { population, clusters = 6, shared = 1, train = 25, test = 150, evalUsers = 100, seed = 3 } = opts;
  const rng = mulberry32(seed);
  const clusterEffect = new Map<string, number>();
  const effect = (c: number, id: string) => {
    const k = `${c}:${id}`;
    if (!clusterEffect.has(k)) clusterEffect.set(k, gaussian(rng));
    return clusterEffect.get(k)!;
  };
  const sample = (pool: (EvalItem & { fame: number })[], k: number) =>
    pool
      .map((it) => ({ it, key: -Math.log(Math.max(rng(), 1e-12)) / (0.1 + it.fame) }))
      .sort((a, b) => a.key - b.key)
      .slice(0, k)
      .map((x) => x.it);

  type Person = { id: string; util: (it: EvalItem) => number; rated: Map<string, number>; trainIds: Set<string> };
  const people: Person[] = [];
  const ratings = new Map<string, Map<string, number>>();
  for (let p = 0; p < population; p++) {
    const base = makeUser(rng);
    const c = Math.floor(rng() * clusters);
    const util = (it: EvalItem) => base(it) + shared * effect(c, it.id);
    const trainItems = sample(items, train).map((it) => ({ it, u: util(it) }));
    const sorted = [...trainItems].sort((a, b) => b.u - a.u);
    const cut = [Math.round(train * 0.35), Math.round(train * 0.7)];
    const rated = new Map<string, number>();
    TIERS.forEach((tier: Tier, ti) => {
      const inTier = sorted.slice(ti === 0 ? 0 : cut[ti - 1], ti === 2 ? train : cut[ti]);
      inTier.forEach(({ it }, i) => rated.set(it.id, (scoreAt(tier, i, inTier.length) - 5) / 5));
    });
    const person = { id: `u${p}`, util, rated, trainIds: new Set(trainItems.map((x) => x.it.id)) };
    people.push(person);
    ratings.set(person.id, rated);
  }
  setRatings(ratings);

  const byId = new Map(items.map((it) => [it.id, it]));
  let content = 0, blended = 0, coverage = 0, n = 0;
  for (const person of people.slice(0, evalUsers)) {
    const ranked: RankedForTaste[] = [...person.rated].map(([id, w]) => {
      const it = byId.get(id)!;
      return {
        artworkId: id,
        artistId: it.artistId,
        artistName: it.artistName,
        score: 5 + 5 * w,
        movements: it.movementIds.map((m) => ({ id: m, name: m, source: "artwork" as const })),
        genres: it.genreIds.map((g) => ({ id: g, name: g })),
        year: it.year,
      };
    });
    const taste = buildTaste(ranked);
    const weight = personWeight
      ? personWeight(person.rated, (held) => {
          const it = byId.get(held)!;
          return predictScore(it, buildTaste(ranked.filter((r) => r.artworkId !== held))).score;
        }, person.id)
      : null;
    const testItems = sample(items.filter((it) => !person.trainIds.has(it.id)), test);
    const truth = testItems.map((it) => person.util(it));
    const cPred = testItems.map((it) => predictScore(it, taste).score);
    let covered = 0;
    const bPred = testItems.map((it, i) => {
      const cf = cfPredict(person.rated, it.id);
      if (cf) covered++;
      return blend(cPred[i], cf, weight);
    });
    content += spearman(cPred, truth);
    blended += spearman(bPred, truth);
    coverage += covered / testItems.length;
    n++;
  }
  return { content: content / n, blended: blended / n, coverage: coverage / n };
}
