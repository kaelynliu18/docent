import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/algo/vectors";
import { reasonText, recommend } from "@/lib/algo/recommend";

// Three "styles" as directions; paintings are small wobbles around them.
const style = { blue: [1, 0, 0], red: [0, 1, 0], green: [0, 0, 1] } as const;
const p = (id: string, s: keyof typeof style, w = 0.05) => ({ id, vector: style[s].map((x, i) => x + (i === 0 ? w : -w)) });
const index = buildIndex(
  [p("b1", "blue"), p("b2", "blue", 0.1), p("b3", "blue", 0.15), p("r1", "red"), p("r2", "red", 0.1), p("g1", "green"), p("g2", "green", 0.1)],
  3,
);

describe("recommend", () => {
  it("cold start: recommends what looks like what you loved, with a reason", () => {
    const recs = recommend({
      ranked: [{ id: "b1", score: 9.6, rank: 1, title: "Water Lilies" }],
      candidates: ["b2", "b3", "r1", "g1"],
      index,
      opts: { limit: 2, mmrLambda: 1 },
    });
    expect(recs.map((r) => r.id)).toEqual(["b2", "b3"]);
    expect(reasonText(recs[0].reason)).toBe("Looks like your #1, Water Lilies");
  });

  it("pushes away from what you disliked", () => {
    const recs = recommend({
      ranked: [
        { id: "b1", score: 9, rank: 1, title: "A" },
        { id: "r1", score: 1, rank: 2, title: "B" },
      ],
      candidates: ["r2", "g1", "b2"],
      index,
      opts: { limit: 3, mmrLambda: 1 },
    });
    expect(recs.map((r) => r.id).at(-1)).toBe("r2");
  });

  it("falls back to popularity with no usable rankings", () => {
    const recs = recommend({ ranked: [], candidates: ["g1", "r1", "b2"], index, popularity: (id) => ({ g1: 0.2, r1: 0.9, b2: 0.5 })[id]! });
    expect(recs.map((r) => r.id)).toEqual(["r1", "b2", "g1"]);
    expect(recs[0].reason.kind).toBe("popular");
  });

  it("MMR mixes styles instead of returning near-duplicates", () => {
    const base = { ranked: [{ id: "b1", score: 9, rank: 1, title: "A" }, { id: "g2", score: 7.5, rank: 2, title: "B" }], candidates: ["b2", "b3", "g1"], index };
    expect(recommend({ ...base, opts: { limit: 2, mmrLambda: 1 } }).map((r) => r.id)).toEqual(["b2", "b3"]);
    expect(recommend({ ...base, opts: { limit: 2, mmrLambda: 0.3 } }).map((r) => r.id)).toContain("g1");
  });

  it("warm users blend in the trait/CF score", () => {
    const ranked = Array.from({ length: 6 }, (_, i) => ({ id: "b1", score: 9, rank: i + 1, title: "A" }));
    const base = { ranked, candidates: ["b2", "g1"], index, opts: { limit: 1, mmrLambda: 1 } };
    expect(recommend(base)[0].id).toBe("b2");
    // The trait model is sure about g1 (e.g. a loved artist): with full blend it wins.
    expect(recommend({ ...base, warm: (id) => (id === "g1" ? 9.8 : 3), opts: { ...base.opts, embedBlend: 1 } })[0].id).toBe("g1");
  });
});
