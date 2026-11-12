import { describe, expect, it } from "vitest";
import { blendedTierScores, btTierScores, fitStrengths, isotonicNonIncreasing } from "@/lib/algo/bradleyTerry";
import { BANDS } from "@/lib/algo/scoring";
import { blendWithCf, buildCfIndex, cfPredict, fitCfWeight, itemSimilarity, looCfPoints, type Ratings } from "@/lib/algo/cf";
import { explainPrediction, explanationText } from "@/lib/algo/explain";
import { buildTaste } from "@/lib/algo/taste";
import { guessIndex, guidedAnswer, guidedProbe, startGuided, simulateSessions, evenSpacing, shrunkSpacing, blendSpacing, type Strategy } from "@/lib/algo/simulate";
import { evaluateCf, mulberry32, type EvalItem } from "@/lib/algo/evaluate";
import type { Comparison } from "@/lib/algo/insertion";
import { TIERS, type RankedForTaste } from "@/lib/algo/types";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `Q${i + 1}`);
const win = (w: string, l: string, tie = false): Comparison => ({ winnerId: w, loserId: l, wasTie: tie });

describe("Bradley–Terry tier scores", () => {
  it("isotonic regression pools violators", () => {
    expect(isotonicNonIncreasing([3, 1, 2, 0])).toEqual([3, 1.5, 1.5, 0]);
    expect(isotonicNonIncreasing([1, 2, 3])).toEqual([2, 2, 2]);
    expect(isotonicNonIncreasing([])).toEqual([]);
  });

  it("orders strengths by wins and pulls tied paintings together", () => {
    const order = ["A", "B", "C"];
    const decisive = fitStrengths(order, [win("A", "B"), win("A", "B"), win("B", "C"), win("B", "C")]);
    expect(decisive[0]).toBeGreaterThan(decisive[1]);
    expect(decisive[1]).toBeGreaterThan(decisive[2]);
    const tied = fitStrengths(order, [win("A", "B", true), win("A", "B", true), win("B", "C"), win("B", "C")]);
    expect(tied[0] - tied[1]).toBeLessThan(decisive[0] - decisive[1]);
  });

  it("scores stay in the band, follow list order, and handle tiny tiers", () => {
    expect(btTierScores("loved", ["A"], [])).toEqual([(BANDS.loved.min + BANDS.loved.max) / 2]);
    expect(blendedTierScores("fine", [], [])).toEqual([]);
    const rng = mulberry32(42);
    for (let trial = 0; trial < 200; trial++) {
      const tier = TIERS[trial % 3];
      const order = ids(1 + Math.floor(rng() * 25));
      const comps: Comparison[] = [];
      for (let k = 0; k < order.length * 2; k++) {
        const a = Math.floor(rng() * order.length);
        const b = Math.floor(rng() * order.length);
        if (a === b) continue;
        // Mostly consistent with the list, sometimes not, sometimes ties.
        const r = rng();
        comps.push(r < 0.1 ? win(order[a], order[b], true) : r < 0.2 === a < b ? win(order[b], order[a]) : win(order[Math.min(a, b)], order[Math.max(a, b)]));
      }
      const sc = blendedTierScores(tier, order, comps);
      expect(sc).toHaveLength(order.length);
      for (let i = 0; i < sc.length; i++) {
        expect(sc[i]).toBeGreaterThanOrEqual(BANDS[tier].min - 1e-9);
        expect(sc[i]).toBeLessThanOrEqual(BANDS[tier].max + 1e-9);
        if (i) expect(sc[i]).toBeLessThanOrEqual(sc[i - 1] + 1e-9);
      }
    }
  });
});

describe("guided insertion (experiment)", () => {
  it("every strategy finds the exact slot for any guess", () => {
    const rng = mulberry32(7);
    const strategies: Strategy[] = ["bisect", "guess-first", "gallop", "nudge"];
    for (let trial = 0; trial < 500; trial++) {
      const n = Math.floor(rng() * 30);
      const list = ids(n);
      const truth = Math.floor(rng() * (n + 1)); // the slot the person would choose
      const guess = rng() < 0.2 ? null : Math.floor(rng() * (n + 1));
      for (const strategy of strategies) {
        let s = startGuided("NEW", list, guess, strategy);
        let steps = 0;
        while (s.index === null && steps++ < 100) s = guidedAnswer(s, guidedProbe(s)! < truth ? "item" : "new");
        expect(s.index).toBe(truth);
        if (strategy === "bisect") expect(s.asked).toBeLessThanOrEqual(Math.ceil(Math.log2(n + 1)));
      }
    }
  });

  it("guessIndex places a prediction among tier scores, or abstains", () => {
    expect(guessIndex([9, 8, 7, 6], 7.5, true)).toBe(2);
    expect(guessIndex([9, 8, 7, 6], 7.5, false)).toBeNull();
    expect(guessIndex([9, 8], 7.5, true)).toBeNull();
  });
});

describe("collaborative filtering", () => {
  const ratings: Ratings = new Map();
  // 12 people: half love A and B together and dislike C; the other half the reverse. D is neutral noise.
  for (let u = 0; u < 12; u++) {
    const g = u % 2 === 0 ? 1 : -1;
    ratings.set(`u${u}`, new Map([["A", 0.8 * g], ["B", 0.7 * g], ["C", -0.6 * g], ["D", (u % 3) / 3 - 0.3]]));
  }
  const idx = buildCfIndex(ratings);

  it("similar paintings score high, opposite ones negative, and exclusion removes a person", () => {
    expect(itemSimilarity(idx, "A", "B")).toBeGreaterThan(0.4);
    expect(itemSimilarity(idx, "A", "C")).toBeLessThan(-0.4);
    expect(itemSimilarity(idx, "A", "A")).toBe(1);
    expect(itemSimilarity(idx, "A", "Z")).toBe(0);
    expect(itemSimilarity(idx, "A", "B", undefined, "u0")).not.toBe(itemSimilarity(idx, "A", "B"));
  });

  it("predicts from neighbours and blends by evidence", () => {
    const me = new Map([["A", 0.9], ["C", -0.5]]);
    const p = cfPredict(idx, me, "B")!;
    expect(p.signed).toBeGreaterThan(0.3);
    expect(p.neighbours[0].id).toBe("A");
    expect(cfPredict(idx, new Map(), "B")).toBeNull();
    expect(blendWithCf(5, null)).toEqual({ score: 5, cfWeight: 0 });
    const b = blendWithCf(5, p);
    expect(b.score).toBeGreaterThan(5);
    expect(b.cfWeight).toBeGreaterThan(0);
    expect(b.cfWeight).toBeLessThan(1);
  });

  it("per-person weight trusts CF only when it beats content on their own rankings", () => {
    const good = Array.from({ length: 20 }, (_, i) => ({ content: 5, cf: 3 + (i % 5), actual: 3 + (i % 5) }));
    expect(fitCfWeight(good)).toBeCloseTo(20 / 30, 5);
    const bad = Array.from({ length: 20 }, (_, i) => ({ content: 3 + (i % 5), cf: 7 - (i % 5), actual: 3 + (i % 5) }));
    expect(fitCfWeight(bad)).toBe(0);
    expect(fitCfWeight([])).toBe(0);
    const pts = looCfPoints(idx, new Map([["A", 0.9], ["B", 0.8], ["C", -0.5]]), () => 5);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) expect(p.content).toBe(5);
  });
});

describe("explanations", () => {
  const r = (id: string, title: string, artistId: string, score: number, movement = "M1"): RankedForTaste & { title: string } => ({
    artworkId: id, title, artistId, artistName: artistId, score, movements: [{ id: movement, name: "Impressionism", source: "artwork" }], genres: [], year: 1880,
  });
  const ranked = [r("1", "Water Lilies", "Monet", 9.5), r("2", "Haystacks", "Monet", 9), r("3", "Guernica", "Picasso", 1.5, "M2")];
  const taste = buildTaste(ranked);
  const refs = ranked.map((x) => ({ id: x.artworkId, title: x.title, score: x.score, artistId: x.artistId, movementIds: x.movements.map((m) => m.id), genreIds: [], year: x.year }));

  it("names the strongest reason and the paintings behind it", () => {
    const reasons = explainPrediction({ artistId: "Monet", movementIds: ["M1"], year: 1890 }, taste, refs);
    expect(reasons[0].kind).toBe("artist");
    expect(reasons[0].examples.map((e) => e.title)).toEqual(["Water Lilies", "Haystacks"]);
    expect(explanationText(reasons)).toBe("Because you loved Water Lilies and Haystacks (Monet).");
  });

  it("explains low predictions with the low-ranked paintings, and says nothing without signal", () => {
    const low = explainPrediction({ artistId: "Picasso", movementIds: ["M2"], year: 1937 }, taste, refs);
    expect(explanationText(low)).toBe("You ranked Guernica low (Picasso).");
    expect(explainPrediction({ artistId: "Nobody", movementIds: [], year: null }, taste, refs)).toEqual([]);
    expect(explanationText([])).toBeNull();
    expect(explanationText([], { titles: ["Water Lilies"] })).toContain("People who ranked Water Lilies");
  });
});

describe("simulation harnesses (smoke)", () => {
  const items: (EvalItem & { fame: number })[] = Array.from({ length: 120 }, (_, i) => ({
    id: `Q${i}`, artistId: `A${i % 15}`, artistName: `A${i % 15}`, movementIds: [`M${i % 5}`], genreIds: [`G${i % 4}`], year: 1500 + (i % 5) * 100, fame: (i % 10) / 10,
  }));

  it("sessions report fidelity and questions per painting", () => {
    const r = simulateSessions(items, { even: evenSpacing, shrunk: shrunkSpacing, blend: blendSpacing }, ["bisect", "gallop"], { users: 8, paintings: 20 });
    for (const k of ["even", "shrunk", "blend"]) {
      expect(r.fidelity[k].spearman).toBeGreaterThan(0.5);
      expect(r.fidelity[k].mae).toBeGreaterThan(0);
    }
    expect(r.questionsPerPainting.bisect).toBeGreaterThan(0);
  });

  it("CF population harness runs and CF stays off with no neighbours", () => {
    let idx = buildCfIndex(new Map());
    const r = evaluateCf(items, { population: 3, train: 5, test: 20, evalUsers: 3 }, (c) => c, (mine, t) => cfPredict(idx, mine, t), (x) => (idx = buildCfIndex(x)));
    expect(r.content).toBe(r.blended);
  });
});
