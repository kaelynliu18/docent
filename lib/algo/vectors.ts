/**
 * Small, exact vector maths for the visual-taste features. All vectors are
 * L2-normalised Float32Arrays, so cosine similarity is a dot product.
 */

export function normalize(v: ArrayLike<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** A packed set of normalised vectors: row i is ids[i]. */
export type VectorIndex = { ids: string[]; dims: number; data: Float32Array; pos: Map<string, number> };

export function buildIndex(rows: { id: string; vector: ArrayLike<number> }[], dims: number): VectorIndex {
  const data = new Float32Array(rows.length * dims);
  const ids: string[] = [];
  rows.forEach((r, i) => {
    data.set(normalize(r.vector), i * dims);
    ids.push(r.id);
  });
  return { ids, dims, data, pos: new Map(ids.map((id, i) => [id, i])) };
}

export function vectorOf(ix: VectorIndex, id: string): Float32Array | null {
  const i = ix.pos.get(id);
  return i === undefined ? null : ix.data.subarray(i * ix.dims, (i + 1) * ix.dims);
}

/** Cosine similarity of `q` against every row. */
export function scoreAll(ix: VectorIndex, q: ArrayLike<number>): Float32Array {
  const out = new Float32Array(ix.ids.length);
  const d = ix.dims;
  for (let r = 0; r < ix.ids.length; r++) {
    let s = 0;
    const o = r * d;
    for (let i = 0; i < d; i++) s += ix.data[o + i] * q[i];
    out[r] = s;
  }
  return out;
}

/** Exact top-k by cosine similarity, skipping ids in `exclude` and failing `keep`. */
export function topK(
  ix: VectorIndex,
  q: ArrayLike<number>,
  k: number,
  opts: { exclude?: Set<string>; keep?: (id: string) => boolean } = {},
): { id: string; score: number }[] {
  const scores = scoreAll(ix, q);
  const out: { id: string; score: number }[] = [];
  for (let r = 0; r < scores.length; r++) {
    const id = ix.ids[r];
    if (opts.exclude?.has(id) || (opts.keep && !opts.keep(id))) continue;
    out.push({ id, score: scores[r] });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, k);
}

/**
 * A user's taste vector: the weighted mean of the embeddings of what they
 * ranked, normalised. Weight = (score − 5) / 5, so a 10 pulls toward a
 * painting, a 5 is neutral and a 0 pushes away (Rocchio-style).
 */
export function tasteVector(ix: VectorIndex, ranked: { id: string; score: number }[]): Float32Array | null {
  const acc = new Float32Array(ix.dims);
  let any = false;
  for (const r of ranked) {
    const v = vectorOf(ix, r.id);
    if (!v) continue;
    const w = (r.score - 5) / 5;
    if (w === 0) continue;
    for (let i = 0; i < ix.dims; i++) acc[i] += w * v[i];
    any = true;
  }
  if (!any) return null;
  let n = 0;
  for (let i = 0; i < acc.length; i++) n += acc[i] * acc[i];
  return n === 0 ? null : normalize(acc);
}

/**
 * Maximal marginal relevance: repeatedly pick the candidate with the best
 * λ·relevance − (1 − λ)·(max similarity to anything already picked), so the
 * list isn't twenty near-copies of one painting.
 */
export function mmr<T extends { id: string; score: number }>(ix: VectorIndex, candidates: T[], k: number, lambda: number): T[] {
  const picked: T[] = [];
  const pickedVecs: Float32Array[] = [];
  const pool = [...candidates];
  while (picked.length < k && pool.length) {
    let best = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const v = vectorOf(ix, pool[i].id);
      let redundancy = 0;
      if (v) for (const p of pickedVecs) redundancy = Math.max(redundancy, dot(v, p));
      const val = lambda * pool[i].score - (1 - lambda) * redundancy;
      if (val > bestVal) {
        bestVal = val;
        best = i;
      }
    }
    const [c] = pool.splice(best, 1);
    picked.push(c);
    const v = vectorOf(ix, c.id);
    if (v) pickedVecs.push(v);
  }
  return picked;
}

/**
 * Hybrid image + text similarity in one index: concatenate √w·image and
 * √(1−w)·text. For normalised parts, a dot product of two such vectors is
 * exactly w·cos(image) + (1−w)·cos(text). Missing text falls back to image only.
 */
export function hybridVector(image: ArrayLike<number>, text: ArrayLike<number> | null, imageWeight: number): Float32Array {
  const out = new Float32Array(image.length * 2);
  const a = Math.sqrt(text ? imageWeight : 1);
  const b = Math.sqrt(1 - imageWeight);
  const ni = normalize(image);
  for (let i = 0; i < image.length; i++) out[i] = a * ni[i];
  if (text) {
    const nt = normalize(text);
    for (let i = 0; i < text.length; i++) out[image.length + i] = b * nt[i];
  }
  return out;
}

/** Image index and hybrid (image + text) index from stored embedding rows. */
export function indexesFromRows(
  rows: { id: string; kind: string; vector: ArrayLike<number> }[],
  dims: number,
  imageWeight: number,
): { image: VectorIndex; hybrid: VectorIndex } {
  const text = new Map(rows.filter((r) => r.kind === "text").map((r) => [r.id, r.vector]));
  const images = rows.filter((r) => r.kind === "image");
  return {
    image: buildIndex(images.map((r) => ({ id: r.id, vector: r.vector })), dims),
    hybrid: buildIndex(images.map((r) => ({ id: r.id, vector: hybridVector(r.vector, text.get(r.id) ?? null, imageWeight) })), dims * 2),
  };
}
