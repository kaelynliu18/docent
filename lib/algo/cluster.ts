import { dot, normalize } from "./vectors";

/**
 * Spherical k-means (cosine) with k-means++ seeding and a seeded random
 * source, so the same embeddings always give the same clusters.
 * `vectors` are normalised; returns each row's cluster and the centroids.
 */
export function kmeans(vectors: Float32Array[], k: number, random: () => number, iterations = 30): { assign: number[]; centroids: Float32Array[] } {
  const n = vectors.length;
  if (n === 0) return { assign: [], centroids: [] };
  k = Math.min(k, n);
  const centroids: Float32Array[] = [vectors[Math.floor(random() * n)]];
  const dist = new Float64Array(n).fill(Infinity);
  while (centroids.length < k) {
    const last = centroids[centroids.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const d = 1 - dot(vectors[i], last);
      if (d < dist[i]) dist[i] = d;
      total += dist[i] * dist[i];
    }
    let r = random() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= dist[i] * dist[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    centroids.push(vectors[pick]);
  }
  const assign = new Array<number>(n).fill(-1);
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bestSim = -Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const sim = dot(vectors[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        moved++;
      }
    }
    const dims = vectors[0].length;
    const sums = centroids.map(() => new Float32Array(dims));
    const counts = new Array<number>(centroids.length).fill(0);
    for (let i = 0; i < n; i++) {
      counts[assign[i]]++;
      const s = sums[assign[i]];
      for (let d = 0; d < dims; d++) s[d] += vectors[i][d];
    }
    for (let c = 0; c < centroids.length; c++) if (counts[c]) centroids[c] = normalize(sums[c]);
    if (moved === 0) break;
  }
  return { assign, centroids };
}

/**
 * Names each cluster after what most of its members share, from catalogue
 * metadata: the most common movement (if it covers ≥ 25% of members), else the
 * most common genre, plus the dominant century. Labels are made unique by
 * adding the next most common trait.
 */
export function labelClusters(
  members: { movements: string[]; genres: string[]; century: string | null }[][],
): string[] {
  const top = (xs: string[]) => {
    const c = new Map<string, number>();
    for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  };
  const base = members.map((m) => {
    const mv = top(m.flatMap((x) => x.movements));
    const gn = top(m.flatMap((x) => x.genres));
    const cen = top(m.map((x) => x.century).filter((x): x is string => !!x));
    const lead = mv[0] && mv[0][1] >= m.length * 0.25 ? mv[0][0] : (gn[0]?.[0] ?? "Mixed");
    const extra = [mv[0]?.[0] === lead ? gn[0]?.[0] : mv[0]?.[0], gn[1]?.[0]].filter((x): x is string => !!x && x !== lead);
    return { lead, century: cen[0]?.[0] ?? null, extra };
  });
  const labels = base.map((b) => (b.century ? `${cap(b.lead)}, ${b.century}` : cap(b.lead)));
  // Disambiguate duplicates: add the member's next traits until unique, then number them.
  const out = [...labels];
  const used = new Set<string>();
  const count = new Map<string, number>();
  labels.forEach((l) => count.set(l, (count.get(l) ?? 0) + 1));
  labels.forEach((l, i) => {
    if (count.get(l)! === 1) return void used.add(l);
    let name = l;
    for (const x of base[i].extra) {
      if (!used.has(name)) break;
      name = `${l} · ${x}`;
    }
    if (used.has(name) && !used.has(`${l} · ${base[i].extra[0]}`) && base[i].extra[0]) name = `${l} · ${base[i].extra[0]}`;
    for (let n = 2; used.has(name); n++) name = `${l} (${n})`;
    used.add(name);
    out[i] = name;
  });
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
