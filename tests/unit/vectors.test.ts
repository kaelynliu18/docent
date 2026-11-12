import { describe, expect, it } from "vitest";
import { buildIndex, dot, hybridVector, mmr, normalize, scoreAll, tasteVector, topK, vectorOf } from "@/lib/algo/vectors";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
}
const randomVec = (r: () => number, d: number) => Array.from({ length: d }, r);

describe("nearest neighbours", () => {
  const r = rng(1);
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: `a${i}`, vector: randomVec(r, 32) }));
  const ix = buildIndex(rows, 32);

  it("matches a brute-force cosine ranking exactly", () => {
    const q = normalize(randomVec(r, 32));
    const brute = rows
      .map((x) => ({ id: x.id, score: dot(normalize(x.vector), q) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((x) => x.id);
    expect(topK(ix, q, 10).map((x) => x.id)).toEqual(brute);
  });

  it("finds a vector's own row first and respects exclude/keep", () => {
    const q = vectorOf(ix, "a7")!;
    expect(topK(ix, q, 1)[0]).toMatchObject({ id: "a7" });
    expect(topK(ix, q, 1)[0].score).toBeCloseTo(1, 5);
    expect(topK(ix, q, 5, { exclude: new Set(["a7"]) }).map((x) => x.id)).not.toContain("a7");
    expect(topK(ix, q, 5, { keep: (id) => id.endsWith("3") }).every((x) => x.id.endsWith("3"))).toBe(true);
  });

  it("searches a catalogue-sized index (9,200 × 1,024) in under 100 ms", () => {
    const big = buildIndex(Array.from({ length: 9200 }, (_, i) => ({ id: String(i), vector: randomVec(r, 1024) })), 1024);
    const q = normalize(randomVec(r, 1024));
    topK(big, q, 10); // warm up
    const t = performance.now();
    topK(big, q, 10);
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe("taste vector", () => {
  const ix = buildIndex(
    [
      { id: "blue", vector: [1, 0, 0] },
      { id: "red", vector: [0, 1, 0] },
      { id: "green", vector: [0, 0, 1] },
    ],
    3,
  );

  it("leans toward what was loved and away from what was disliked", () => {
    const t = tasteVector(ix, [
      { id: "blue", score: 9.5 },
      { id: "red", score: 1 },
    ])!;
    const s = scoreAll(ix, t);
    expect(s[0]).toBeGreaterThan(0.5); // blue
    expect(s[1]).toBeLessThan(0); // red
    expect(Math.abs(s[2])).toBeLessThan(1e-6); // green untouched
  });

  it("is null when nothing usable was ranked", () => {
    expect(tasteVector(ix, [{ id: "blue", score: 5 }])).toBeNull();
    expect(tasteVector(ix, [{ id: "missing", score: 9 }])).toBeNull();
  });
});

describe("mmr", () => {
  it("swaps a near-duplicate for something different", () => {
    const ix = buildIndex(
      [
        { id: "lilies1", vector: [1, 0.01] },
        { id: "lilies2", vector: [1, 0.02] },
        { id: "other", vector: [0.6, 0.8] },
      ],
      2,
    );
    const cands = [
      { id: "lilies1", score: 0.95 },
      { id: "lilies2", score: 0.94 },
      { id: "other", score: 0.8 },
    ];
    expect(mmr(ix, cands, 2, 1).map((c) => c.id)).toEqual(["lilies1", "lilies2"]); // pure relevance
    expect(mmr(ix, cands, 2, 0.6).map((c) => c.id)).toEqual(["lilies1", "other"]);
  });
});

describe("hybridVector", () => {
  it("makes a dot product equal w·cos(image) + (1−w)·cos(text)", () => {
    const r = rng(9);
    const [i1, i2, t1, t2] = [0, 1, 2, 3].map(() => normalize(randomVec(r, 16)));
    const w = 0.7;
    const h = dot(hybridVector(i1, t1, w), hybridVector(i2, t2, w));
    expect(h).toBeCloseTo(w * dot(i1, i2) + (1 - w) * dot(t1, t2), 5);
    expect(dot(hybridVector(i1, t1, w), hybridVector(i1, t1, w))).toBeCloseTo(1, 5);
  });
});
