/**
 * Item–item collaborative filtering: "people who ranked the paintings you
 * ranked the way you did also loved this one". Pure; works on signed scores
 * w = (score − 5) / 5 in [−1, 1].
 *
 * Similarity is adjusted cosine over co-raters (each person's mean removed, so
 * a generous ranker and a harsh one agree when their *relative* tastes do),
 * shrunk by n / (n + β) so two paintings that share only a couple of rankers
 * don't look identical. The blend with the content prediction grows with the
 * amount of neighbour evidence, so CF is silent until there's data.
 */
export type Ratings = Map<string, Map<string, number>>; // userId → itemId → signed score

export type CfIndex = {
  /** itemId → userId → centred score */
  byItem: Map<string, Map<string, number>>;
  userMean: Map<string, number>;
  cache: Map<string, number>;
};

export const CF_DEFAULTS = { shrink: 10, minCoRaters: 2, neighbours: 30, evidenceHalf: 1.5 };

export function buildCfIndex(ratings: Ratings): CfIndex {
  const byItem = new Map<string, Map<string, number>>();
  const userMean = new Map<string, number>();
  for (const [u, items] of ratings) {
    if (!items.size) continue;
    let sum = 0;
    for (const w of items.values()) sum += w;
    const mean = sum / items.size;
    userMean.set(u, mean);
    for (const [i, w] of items) {
      let m = byItem.get(i);
      if (!m) byItem.set(i, (m = new Map()));
      m.set(u, w - mean);
    }
  }
  return { byItem, userMean, cache: new Map() };
}

/** `exclude`: leave one person out (for honest self-checks on their own rankings). */
export function itemSimilarity(idx: CfIndex, a: string, b: string, opts = CF_DEFAULTS, exclude?: string): number {
  if (a === b) return 1;
  const key = (a < b ? `${a}|${b}` : `${b}|${a}`) + (exclude ? `|-${exclude}` : "");
  const hit = idx.cache.get(key);
  if (hit !== undefined) return hit;
  const ma = idx.byItem.get(a);
  const mb = idx.byItem.get(b);
  let sim = 0;
  if (ma && mb) {
    const [small, big] = ma.size <= mb.size ? [ma, mb] : [mb, ma];
    let dot = 0, na = 0, nb = 0, n = 0;
    for (const [u, x] of small) {
      if (u === exclude) continue;
      const y = big.get(u);
      if (y === undefined) continue;
      dot += x * y;
      na += x * x;
      nb += y * y;
      n++;
    }
    if (n >= opts.minCoRaters && na > 0 && nb > 0) sim = (dot / Math.sqrt(na * nb)) * (n / (n + opts.shrink));
  }
  idx.cache.set(key, sim);
  return sim;
}

/**
 * CF estimate of a person's signed score for `target`, from their own
 * rankings (`mine`, itemId → signed score; they need not be in the index).
 * Returns null when no neighbour has positive similarity.
 */
export function cfPredict(idx: CfIndex, mine: Map<string, number>, target: string, opts = CF_DEFAULTS, exclude?: string) {
  if (!mine.size || !idx.byItem.has(target)) return null;
  let mean = 0;
  for (const w of mine.values()) mean += w;
  mean /= mine.size;
  const neighbours: { id: string; sim: number; w: number }[] = [];
  for (const [i, w] of mine) {
    if (i === target) continue;
    const sim = itemSimilarity(idx, i, target, opts, exclude);
    if (sim > 0) neighbours.push({ id: i, sim, w });
  }
  if (!neighbours.length) return null;
  neighbours.sort((a, b) => b.sim - a.sim);
  const top = neighbours.slice(0, opts.neighbours);
  let num = 0, den = 0;
  for (const n of top) {
    num += n.sim * (n.w - mean);
    den += n.sim;
  }
  const signed = Math.max(-1, Math.min(1, mean + num / den));
  return { signed, evidence: den, neighbours: top.slice(0, 3) };
}

/**
 * Blend a content-based 0–10 prediction with the CF estimate. The CF weight is
 * evidence / (evidence + evidenceHalf): zero with no neighbours, ½ at
 * `evidenceHalf` total similarity, approaching 1 with lots of agreement.
 */
export function blendWithCf(contentScore: number, cf: { signed: number; evidence: number } | null, opts = CF_DEFAULTS) {
  if (!cf) return { score: contentScore, cfWeight: 0 };
  const alpha = cf.evidence / (cf.evidence + opts.evidenceHalf);
  const cfScore = 5 + 5 * cf.signed;
  return { score: contentScore + alpha * (cfScore - contentScore), cfWeight: alpha };
}

/**
 * Per-person CF weight learned from their own rankings (stacking). For each
 * painting they ranked, compare the content prediction and the CF prediction
 * made without it against what they actually gave it; the least-squares mix
 * α* = Σ(a−c)(f−c) / Σ(f−c)², clamped to [0, 1], shrunk by n / (n + 10).
 * If CF doesn't beat content on this person's own data, α → 0.
 */
export function fitCfWeight(points: { content: number; cf: number; actual: number }[], shrink = 10) {
  let num = 0, den = 0;
  for (const p of points) {
    num += (p.actual - p.content) * (p.cf - p.content);
    den += (p.cf - p.content) ** 2;
  }
  if (!points.length || den <= 1e-9) return 0;
  const alpha = Math.max(0, Math.min(1, num / den));
  return alpha * (points.length / (points.length + shrink));
}

/** Leave-one-out points for fitCfWeight: CF predictions for each ranked painting from the others. */
export function looCfPoints(
  idx: CfIndex,
  mine: Map<string, number>,
  contentLoo: (heldOut: string) => number,
  opts = CF_DEFAULTS,
  self?: string,
) {
  const out: { content: number; cf: number; actual: number }[] = [];
  for (const [id, w] of mine) {
    const rest = new Map(mine);
    rest.delete(id);
    // Their own ranking of the held-out painting must not leak in through the similarities.
    const cf = cfPredict(idx, rest, id, opts, self);
    if (!cf) continue;
    out.push({ content: contentLoo(id), cf: 5 + 5 * cf.signed, actual: 5 + 5 * w });
  }
  return out;
}
