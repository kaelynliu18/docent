import { RECS } from "./config";
import { dot, mmr, scoreAll, tasteVector, vectorOf, type VectorIndex } from "./vectors";

/**
 * Hybrid recommender over the visual embedding space.
 *
 * Ranking data: a user's per-painting scores come from their tiered list
 * (tier band + Bradley–Terry blend on their pairwise comparisons, computed on
 * read in getRankedList); this module only sees (id, score, rank).
 *
 * 1. Taste vector: weighted mean of the embeddings of ranked paintings,
 *    weight (score − 5)/5 (tasteVector in vectors.ts).
 * 2. Cold users (≤ RECS.coldMax rankings): relevance = z(cosine(taste, painting)).
 * 3. Warm users: relevance = (1 − β)·z(cosine) + β·z(warm), where `warm` is the
 *    trait model's predicted score (artist, movement, genre, century, colour,
 *    mood, personal weights), already blended with collaborative filtering by
 *    the caller when enough peers exist. z = z-score over the candidates, so
 *    the two signals are on one scale; β = RECS.embedBlend.
 *    Both add a popularity prior γ·z(fame) (γ = RECS.popularityCold / popularityWarm).
 * 4. Diversity: MMR over the top RECS.candidates with λ = RECS.mmrLambda.
 * 5. Reason: the ranked painting that pulled the recommendation up most
 *    (largest weight × similarity) → "Looks like your #2, Water Lilies".
 */

export type RankedRef = { id: string; score: number; rank: number; title: string };
export type Reason =
  | { kind: "looks_like"; id: string; title: string; rank: number }
  | { kind: "taste" }
  | { kind: "popular" };
export type Recommendation = { id: string; score: number; reason: Reason };

export type RecommendInput = {
  ranked: RankedRef[];
  /** Paintings that may be recommended (unranked, allowed for this user). */
  candidates: string[];
  /** Hybrid image + text index. */
  index: VectorIndex;
  /** Trait/CF predicted score 0–10 for warm users; null when unknown. */
  warm?: (id: string) => number | null;
  /** 0–1 popularity, used when there is no taste to go on. */
  popularity?: (id: string) => number;
  opts?: Partial<typeof RECS>;
};

function zScores(xs: number[]): number[] {
  const n = xs.length || 1;
  const m = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / n) || 1;
  return xs.map((x) => (x - m) / sd);
}

export function recommend(input: RecommendInput): Recommendation[] {
  const o = { ...RECS, ...input.opts };
  const { index, ranked } = input;
  const taste = tasteVector(index, ranked);

  // Nothing to go on yet: most popular first.
  if (!taste) {
    const pop = input.popularity ?? (() => 0);
    return [...input.candidates]
      .sort((a, b) => pop(b) - pop(a))
      .slice(0, o.limit)
      .map((id) => ({ id, score: pop(id), reason: { kind: "popular" as const } }));
  }

  const all = scoreAll(index, taste);
  const cands = input.candidates.filter((id) => index.pos.has(id));
  const cos = cands.map((id) => all[index.pos.get(id)!]);
  const isWarm = ranked.length > o.coldMax && !!input.warm;
  let relevance = zScores(cos);
  if (isWarm) {
    const warm = cands.map((id) => input.warm!(id));
    const mean = warm.filter((x): x is number => x != null).reduce((s, x, _, a) => s + x / a.length, 0);
    const zw = zScores(warm.map((x) => x ?? mean));
    relevance = relevance.map((c, i) => (1 - o.embedBlend) * c + o.embedBlend * zw[i]);
  }
  // Popularity prior: famous paintings are seen (and loved) more, which matters most with little data.
  const gamma = isWarm ? o.popularityWarm : o.popularityCold;
  if (gamma > 0 && input.popularity) {
    const zp = zScores(cands.map((id) => input.popularity!(id)));
    relevance = relevance.map((r, i) => r + gamma * zp[i]);
  }

  const top = cands
    .map((id, i) => ({ id, score: relevance[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, o.candidates);
  // MMR mixes relevance with cosine redundancy, so put relevance on 0–1 first.
  const hi = top[0]?.score ?? 1;
  const lo = top[top.length - 1]?.score ?? 0;
  const scaled = top.map((t) => ({ ...t, score: hi === lo ? 1 : (t.score - lo) / (hi - lo) }));
  const picked = mmr(index, scaled, o.limit, o.mmrLambda);

  const liked = ranked.filter((r) => r.score > 5);
  return picked.map((p) => ({ id: p.id, score: relevance[cands.indexOf(p.id)], reason: reasonFor(index, p.id, liked) }));
}

/** The ranked painting that contributed most to this recommendation. */
export function reasonFor(index: VectorIndex, id: string, liked: RankedRef[]): Reason {
  const v = vectorOf(index, id);
  if (!v) return { kind: "taste" };
  let best: RankedRef | null = null;
  let bestVal = 0;
  for (const r of liked) {
    const rv = vectorOf(index, r.id);
    if (!rv) continue;
    const val = ((r.score - 5) / 5) * dot(v, rv);
    if (val > bestVal) {
      bestVal = val;
      best = r;
    }
  }
  return best ? { kind: "looks_like", id: best.id, title: best.title, rank: best.rank } : { kind: "taste" };
}

export function reasonText(r: Reason): string {
  if (r.kind === "looks_like") return `Looks like your #${r.rank}, ${r.title}`;
  if (r.kind === "popular") return "Popular with visitors";
  return "Fits your taste";
}
