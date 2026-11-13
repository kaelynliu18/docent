import { recommend } from "./recommend";
import { buildTaste } from "./taste";
import { predictScore } from "./predict";
import { scoreAt } from "./scoring";
import { buildCfIndex, cfPredict, blendWithCf, type Ratings } from "./cf";
import { dot, normalize, tasteVector, topK, type VectorIndex } from "./vectors";
import { RECS } from "./config";
import { gaussian, mulberry32 } from "./evaluate";
import { TIERS, type RankedForTaste, type Tier } from "./types";

/**
 * Offline evaluation of recommenders with SYNTHETIC users (there aren't enough
 * real ones yet). Each user belongs to one of `clusters` taste groups centred
 * on a few real paintings' image embeddings; their hidden utility for a
 * painting mixes visual taste, a liking per artist, popularity and noise
 * (weights in `truth`, all on comparable scales). They "see" paintings with
 * probability ∝ 0.1 + fame, rank what they saw, and their top `holdout` are
 * hidden. Each method recommends from everything they haven't ranked;
 * metrics are hit rate@k (any hidden favourite in the top k) and NDCG@k.
 */
export type EvalPainting = { id: string; artistId: string; artistName: string; movementIds: string[]; genreIds: string[]; year: number | null; fame: number; looks?: string[]; moods?: string[] };
export type Truth = { visual: number; artist: number; popularity: number; noise: number };
export type Method = "random" | "popularity" | "traits" | "content" | "hybrid" | "hybrid (no MMR)";

export function hitAndNdcg(recs: string[], relevant: Set<string>, k: number) {
  const top = recs.slice(0, k);
  const hit = top.some((id) => relevant.has(id)) ? 1 : 0;
  let dcg = 0;
  top.forEach((id, i) => {
    if (relevant.has(id)) dcg += 1 / Math.log2(i + 2);
  });
  let ideal = 0;
  for (let i = 0; i < Math.min(k, relevant.size); i++) ideal += 1 / Math.log2(i + 2);
  return { hit, ndcg: ideal ? dcg / ideal : 0 };
}

export function evaluateRecommenders(
  items: EvalPainting[],
  image: VectorIndex,
  hybrid: VectorIndex,
  opts: { users: number; seen: number; train: number; holdout?: number; k?: number; clusters?: number; truth: Truth; seed?: number; methods?: Method[]; recOpts?: Partial<typeof RECS> },
) {
  const { users, seen, train, holdout = 5, k = 10, clusters = 8, truth, seed = 11 } = opts;
  const methods = opts.methods ?? (["random", "popularity", "traits", "content", "hybrid", "hybrid (no MMR)"] as Method[]);
  const rng = mulberry32(seed);
  const withVec = items.filter((it) => image.pos.has(it.id) && hybrid.pos.has(it.id));
  const byId = new Map(withVec.map((it) => [it.id, it]));
  const dims = image.dims;
  const vec = (id: string) => image.data.subarray(image.pos.get(id)! * dims, (image.pos.get(id)! + 1) * dims);

  // Taste groups: centre = mean image embedding of 4 random paintings.
  const centres = Array.from({ length: clusters }, () => {
    const acc = new Float32Array(dims);
    for (let j = 0; j < 4; j++) {
      const v = vec(withVec[Math.floor(rng() * withVec.length)].id);
      for (let i = 0; i < dims; i++) acc[i] += v[i];
    }
    return normalize(acc);
  });
  // Standardise visual similarity so `truth.visual` is on the same scale as the other terms.
  const sample = withVec.slice(0, 400).map((it) => dot(centres[0], vec(it.id)));
  const sMean = sample.reduce((a, b) => a + b, 0) / sample.length;
  const sSd = Math.sqrt(sample.reduce((a, b) => a + (b - sMean) ** 2, 0) / sample.length) || 1;
  const fames = withVec.map((it) => it.fame);
  const fMean = fames.reduce((a, b) => a + b, 0) / fames.length;
  const fSd = Math.sqrt(fames.reduce((a, b) => a + (b - fMean) ** 2, 0) / fames.length) || 1;

  type U = { ranked: RankedForTaste[]; trainIds: Set<string>; hidden: Set<string> };
  const people: U[] = [];
  for (let u = 0; u < users; u++) {
    const c = centres[Math.floor(rng() * clusters)];
    const dir = new Float32Array(dims);
    for (let i = 0; i < dims; i++) dir[i] = c[i] + 0.02 * gaussian(rng);
    const p = normalize(dir);
    const artistPref = new Map<string, number>();
    const pref = (a: string) => {
      if (!artistPref.has(a)) artistPref.set(a, gaussian(rng));
      return artistPref.get(a)!;
    };
    const utility = (it: EvalPainting) =>
      truth.visual * ((dot(p, vec(it.id)) - sMean) / sSd) + truth.artist * pref(it.artistId) + truth.popularity * ((it.fame - fMean) / fSd) + truth.noise * gaussian(rng);
    // See `seen` paintings, weighted toward famous ones.
    const chosen = new Set<string>();
    while (chosen.size < Math.min(seen, withVec.length)) {
      const it = withVec[Math.floor(rng() * withVec.length)];
      if (rng() < 0.1 + it.fame) chosen.add(it.id);
    }
    const scored = [...chosen].map((id) => ({ it: byId.get(id)!, u: utility(byId.get(id)!) })).sort((a, b) => b.u - a.u);
    const hidden = new Set(scored.slice(0, holdout).map((x) => x.it.id));
    // Train on a random subset of the rest (a new user has ranked only a few).
    const rest = scored.slice(holdout);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const trainSet = rest.slice(0, train).sort((a, b) => b.u - a.u);
    const cut = [Math.round(trainSet.length * 0.35), Math.round(trainSet.length * 0.7)];
    const ranked: RankedForTaste[] = [];
    TIERS.forEach((tier: Tier, ti) => {
      const inTier = trainSet.slice(ti === 0 ? 0 : cut[ti - 1], ti === 2 ? trainSet.length : cut[ti]);
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
    people.push({ ranked, trainIds: new Set(trainSet.map((x) => x.it.id)), hidden });
  }

  // Collaborative index from everyone's training rankings (hidden favourites never leak).
  const ratings: Ratings = new Map(people.map((p, i) => [`u${i}`, new Map(p.ranked.map((r) => [r.artworkId, (r.score - 5) / 5]))]));
  const cfIdx = buildCfIndex(ratings);

  const totals = Object.fromEntries(methods.map((m) => [m, { hit: 0, ndcg: 0 }]));
  const allIds = withVec.map((it) => it.id);
  people.forEach((p, pi) => {
    const candidates = allIds.filter((id) => !p.trainIds.has(id));
    const taste = buildTaste(p.ranked);
    const rankedRefs = p.ranked.map((r, i) => ({ id: r.artworkId, score: r.score, rank: i + 1, title: r.artworkId }));
    const trait = (id: string) => {
      const it = byId.get(id)!;
      return predictScore({ artistId: it.artistId, movementIds: it.movementIds, genreIds: it.genreIds, year: it.year, looks: it.looks, moods: it.moods }, taste).score;
    };
    const mine = ratings.get(`u${pi}`)!;
    const warm = (id: string) => {
      const content = trait(id);
      const cf = cfPredict(cfIdx, mine, id, undefined, `u${pi}`);
      if (!cf) return content;
      const b = blendWithCf(content, cf);
      return content + b.cfWeight * (5 + 5 * cf.signed - content);
    };
    for (const m of methods) {
      let recs: string[];
      if (m === "random") {
        const c = [...candidates];
        for (let i = 0; i < k; i++) {
          const j = i + Math.floor(rng() * (c.length - i));
          [c[i], c[j]] = [c[j], c[i]];
        }
        recs = c.slice(0, k);
      } else if (m === "popularity") recs = [...candidates].sort((a, b) => byId.get(b)!.fame - byId.get(a)!.fame).slice(0, k);
      else if (m === "traits") recs = candidates.map((id) => ({ id, s: trait(id) })).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.id);
      else if (m === "content")
        recs = recommend({ ranked: rankedRefs, candidates, index: hybrid, opts: { limit: k, coldMax: Infinity, mmrLambda: 1, popularityCold: 0 } }).map((r) => r.id);
      else {
        // Mirror getRecommendations: warm users get the trait model on the visually closest
        // shortlist and collaborative filtering on its top 60 (CF on everything is too slow).
        let shortlist = candidates;
        let warmMap: Map<string, number> | undefined;
        if (rankedRefs.length > RECS.coldMax) {
          const t = tasteVector(hybrid, rankedRefs);
          const allowed = new Set(candidates);
          if (t) shortlist = topK(hybrid, t, RECS.candidates * 2, { keep: (id) => allowed.has(id) }).map((x) => x.id);
          warmMap = new Map(shortlist.map((id, i) => [id, i < 60 ? warm(id) : trait(id)]));
        }
        recs = recommend({
          ranked: rankedRefs,
          candidates: shortlist,
          index: hybrid,
          warm: warmMap && ((id) => warmMap!.get(id) ?? null),
          popularity: (id) => byId.get(id)!.fame,
          opts: { ...opts.recOpts, limit: k, ...(m === "hybrid" ? {} : { mmrLambda: 1 }) },
        }).map((r) => r.id);
      }
      const r = hitAndNdcg(recs, p.hidden, k);
      totals[m].hit += r.hit;
      totals[m].ndcg += r.ndcg;
    }
  });
  for (const m of methods) {
    totals[m].hit /= people.length;
    totals[m].ndcg /= people.length;
  }
  return totals as Record<Method, { hit: number; ndcg: number }>;
}

