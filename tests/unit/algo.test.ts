import { describe, expect, it } from "vitest";
import {
  answer,
  currentOpponent,
  maxQuestions,
  slotNeighbours,
  startInsertion,
  type Answer,
} from "@/lib/algo/insertion";
import { roundScore, scoreAt, scoreTier } from "@/lib/algo/scoring";
import { buildTaste, periodOf, signedWeight, topNegative, topPositive } from "@/lib/algo/taste";
import { predictScore } from "@/lib/algo/predict";
import { masterpieceTerm, matchMuseums, type MuseumInput } from "@/lib/algo/match";
import { noRepeatArtist, pickQueue, type QueueCandidate } from "@/lib/algo/queue";
import type { RankedForTaste } from "@/lib/algo/types";

/** Simulate a user whose true preference is a numeric rank (lower = better). */
function insertWithOracle(items: string[], newId: string, truth: Record<string, number>) {
  let s = startInsertion(newId, items);
  let asked = 0;
  while (s.index === null) {
    const opp = currentOpponent(s)!;
    const a: Answer = truth[newId] < truth[opp] ? "new" : "item";
    s = answer(s, a);
    asked++;
  }
  return { s, asked };
}

describe("binary insertion (6.1)", () => {
  it("empty tier places immediately with no questions", () => {
    const s = startInsertion("X", []);
    expect(s.index).toBe(0);
    expect(slotNeighbours(s)).toEqual({ aboveId: null, belowId: null });
  });

  it("tier of 1: one question each way", () => {
    const win = answer(startInsertion("X", ["A"]), "new");
    expect(win.index).toBe(0);
    expect(slotNeighbours(win)).toEqual({ aboveId: null, belowId: "A" });
    const lose = answer(startInsertion("X", ["A"]), "item");
    expect(lose.index).toBe(1);
    expect(slotNeighbours(lose)).toEqual({ aboveId: "A", belowId: null });
  });

  it("tier of 2 lands in the middle", () => {
    const { s } = insertWithOracle(["A", "B"], "X", { A: 1, X: 2, B: 3 });
    expect(s.index).toBe(1);
    expect(slotNeighbours(s)).toEqual({ aboveId: "A", belowId: "B" });
  });

  it("never exceeds ceil(log2(n+1)) questions and finds the exact slot", () => {
    for (const n of [0, 1, 2, 3, 7, 15, 30, 100]) {
      const items = Array.from({ length: n }, (_, i) => `I${i}`);
      const truthBase = Object.fromEntries(items.map((id, i) => [id, i * 2]));
      for (let target = 0; target <= n; target++) {
        const truth = { ...truthBase, X: target * 2 - 1 };
        const { s, asked } = insertWithOracle(items, "X", truth);
        expect(s.index).toBe(target);
        expect(asked).toBeLessThanOrEqual(maxQuestions(n));
      }
    }
    expect(maxQuestions(30)).toBe(5);
    expect(maxQuestions(15)).toBe(4);
    expect(maxQuestions(100)).toBe(7);
  });

  it("tie stops and inserts directly below the compared item", () => {
    let s = startInsertion("X", ["A", "B", "C", "D", "E"]);
    expect(currentOpponent(s)).toBe("C");
    s = answer(s, "tie");
    expect(s.index).toBe(3);
    expect(slotNeighbours(s)).toEqual({ aboveId: "C", belowId: "D" });
    expect(s.comparisons).toEqual([{ winnerId: "X", loserId: "C", wasTie: true }]);
  });

  it("logs each comparison with the right winner", () => {
    const s = answer(answer(startInsertion("X", ["A", "B", "C"]), "item"), "new");
    expect(s.comparisons).toEqual([
      { winnerId: "B", loserId: "X", wasTie: false },
      { winnerId: "X", loserId: "C", wasTie: false },
    ]);
  });
});

describe("scoring (6.2)", () => {
  it("single item sits at the band midpoint", () => {
    expect(roundScore(scoreAt("loved", 0, 1))).toBe(8.4);
    expect(roundScore(scoreAt("fine", 0, 1))).toBe(5.1);
    expect(roundScore(scoreAt("meh", 0, 1))).toBe(1.7);
  });

  it("3-item example: top loved is 9.4", () => {
    const s = scoreTier("loved", 3).map(roundScore);
    expect(s).toEqual([9.4, 8.4, 7.4]);
  });

  it("20 items reaches 9.9 at the top and stays in band", () => {
    const s = scoreTier("loved", 20);
    expect(roundScore(s[0])).toBe(9.9);
    for (const x of s) expect(x).toBeGreaterThanOrEqual(6.8);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeLessThan(s[i - 1]);
  });

  it("tiers never overlap", () => {
    expect(scoreTier("fine", 50)[0]).toBeLessThan(scoreTier("loved", 50)[49]);
    expect(scoreTier("meh", 50)[0]).toBeLessThan(scoreTier("fine", 50)[49]);
  });

  it("rejects out-of-range positions", () => {
    expect(() => scoreAt("loved", 0, 0)).toThrow();
    expect(() => scoreAt("loved", 3, 3)).toThrow();
  });
});

const r = (
  artworkId: string,
  artistId: string,
  score: number,
  movements: RankedForTaste["movements"] = [],
): RankedForTaste => ({ artworkId, artistId, artistName: artistId, score, movements });

describe("taste (6.3)", () => {
  it("maps scores to signed weights", () => {
    expect(signedWeight(10)).toBe(1);
    expect(signedWeight(5)).toBe(0);
    expect(signedWeight(0)).toBe(-1);
  });

  it("five consistent 8s beat a single 9.8", () => {
    const t = buildTaste([
      r("a", "solo", 9.8),
      ...[1, 2, 3, 4, 5].map((i) => r(`b${i}`, "steady", 8)),
    ]);
    expect(t.artists.get("steady")!.affinity).toBeGreaterThan(t.artists.get("solo")!.affinity);
  });

  it("inherited movements count half", () => {
    const t = buildTaste([
      r("a", "x", 10, [{ id: "M1", name: "Imp", source: "artwork" }]),
      r("b", "y", 10, [{ id: "M2", name: "Cub", source: "artist" }]),
    ]);
    expect(t.movements.get("M1")!.affinity).toBeCloseTo(1);
    expect(t.movements.get("M2")!.affinity).toBeCloseTo(0.5);
  });

  it("excludes anonymous artists", () => {
    const t = buildTaste([r("a", "Q4233718", 10)]);
    expect(t.artists.size).toBe(0);
  });

  it("topPositive drops negatives", () => {
    const t = buildTaste([r("a", "x", 9), r("b", "y", 1)]);
    expect(topPositive(t.artists, 5).map((a) => a.id)).toEqual(["x"]);
  });
});

describe("prediction (6.4)", () => {
  it("unknown everything is 5 with low confidence", () => {
    const p = predictScore({ artistId: "x", movementIds: ["M"] }, buildTaste([]));
    expect(p).toEqual({ score: 5, confidence: "low" });
  });

  it("liked artist predicts high, disliked low, always in [0,10]", () => {
    const t = buildTaste([r("a", "good", 10), r("b", "good", 10), r("c", "bad", 0), r("d", "bad", 0)]);
    const hi = predictScore({ artistId: "good", movementIds: [] }, t);
    const lo = predictScore({ artistId: "bad", movementIds: [] }, t);
    expect(hi.score).toBeGreaterThan(8);
    expect(hi.score).toBeLessThanOrEqual(10);
    expect(lo.score).toBeLessThan(2);
    expect(lo.score).toBeGreaterThanOrEqual(0);
    expect(hi.confidence).toBe("normal");
  });

  it("movement-only knowledge is normal confidence", () => {
    const t = buildTaste([r("a", "x", 10, [{ id: "M", name: "M", source: "artwork" }])]);
    const p = predictScore({ artistId: "other", movementIds: ["M"] }, t);
    expect(p.confidence).toBe("normal");
    expect(p.score).toBeGreaterThan(5);
  });
});

const museum = (
  id: string,
  artistHoldings: [string, number][],
  extra: Partial<MuseumInput> = {},
): MuseumInput => ({
  id,
  name: id,
  lat: 0,
  lon: 0,
  artistHoldings: artistHoldings.map(([artistId, count]) => ({ artistId, count })),
  movementHoldings: [],
  ...extra,
});

describe("museum match (6.5)", () => {
  const taste = buildTaste([
    r("a", "monet", 9.5, [{ id: "IMP", name: "Impressionist", source: "artwork" }]),
    r("b", "monet", 9.0),
    r("c", "boring", 1.0),
    r("d", "boring", 0.5),
  ]);

  it("a museum of only disliked artists ranks below one with nothing", () => {
    const res = matchMuseums([museum("bad", [["boring", 40]]), museum("empty", [])], taste);
    expect(res.map((m) => m.id)).toEqual(["empty", "bad"]);
    expect(res[1].raw).toBeLessThan(0);
  });

  it("diminishing returns: 90 beats 9 but not 10x", () => {
    const res = matchMuseums([museum("small", [["monet", 9]]), museum("big", [["monet", 90]])], taste);
    expect(res[0].id).toBe("big");
    expect(res[0].raw / res[1].raw).toBeLessThan(3);
    expect(res[0].matchPct).toBe(100);
  });

  it("explains with the biggest positive terms", () => {
    const res = matchMuseums(
      [
        museum("m", [["monet", 4], ["boring", 10]], {
          movementHoldings: [{ movementId: "IMP", count: 12 }],
        }),
      ],
      taste,
    );
    expect(res[0].reasons).toEqual(["4 by monet", "12 Impressionist works"]);
  });

  it("distance discounts and radius filters", () => {
    const near = museum("near", [["monet", 10]], { lat: 37.77, lon: -122.42 });
    const far = museum("far", [["monet", 50]], { lat: 48.86, lon: 2.34 });
    const origin = { lat: 37.78, lon: -122.41 };
    expect(matchMuseums([near, far], taste, { origin })[0].id).toBe("near");
    expect(matchMuseums([near, far], taste, { origin, radiusKm: 100 }).map((m) => m.id)).toEqual([
      "near",
    ]);
    expect(matchMuseums([near, far], taste)[0].id).toBe("far");
  });

  it("excludes visited museums", () => {
    const res = matchMuseums([museum("a", [["monet", 1]])], taste, { excludeIds: new Set(["a"]) });
    expect(res).toEqual([]);
  });
});

describe("queue (6.6)", () => {
  const c = (id: string, artistId: string, sitelinks: number, movementIds: string[] = []) =>
    ({ id, artistId, sitelinks, movementIds }) satisfies QueueCandidate;

  it("never shows the same artist twice in a row", () => {
    const out = noRepeatArtist(
      [c("1", "a", 1), c("2", "a", 1), c("3", "b", 1), c("4", "a", 1), c("5", "c", 1)],
      "a",
      5,
    );
    const artists = out.map((x) => x.artistId);
    expect(artists[0]).not.toBe("a");
    for (let i = 1; i < artists.length; i++) expect(artists[i]).not.toBe(artists[i - 1]);
  });

  it("cold start cycles movements by fame", () => {
    const ids = pickQueue(
      [c("i1", "a", 50, ["IMP"]), c("i2", "b", 40, ["IMP"]), c("r1", "c", 45, ["REN"])],
      { rankedCount: 0, taste: buildTaste([]), limit: 3 },
    );
    expect(ids).toEqual(["i1", "r1", "i2"]);
  });

  it("personalized queue leans toward liked artists", () => {
    const taste = buildTaste([...Array.from({ length: 10 }, (_, i) => r(`x${i}`, "fav", 9.5))]);
    const cands = [
      ...Array.from({ length: 20 }, (_, i) => c(`f${i}`, i % 2 ? "fav" : "fav2", 10, ["M"])),
      ...Array.from({ length: 20 }, (_, i) => c(`o${i}`, `other${i}`, 10, ["M"])),
    ];
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ids = pickQueue(cands, { rankedCount: 10, taste, limit: 10, rng });
    expect(ids.length).toBe(10);
    const favs = ids.filter((id) => cands.find((x) => x.id === id)!.artistId === "fav").length;
    expect(favs).toBeGreaterThanOrEqual(3);
  });
});

describe("genres, periods and dislikes", () => {
  const landscape = { id: "LAND", name: "landscape painting" };
  const portrait = { id: "PORT", name: "portrait" };

  it("periodOf names centuries", () => {
    expect(periodOf(1889)).toEqual({ id: "C19", name: "19th century" });
    expect(periodOf(1900)).toEqual({ id: "C19", name: "19th century" });
    expect(periodOf(1503)?.name).toBe("16th century");
    expect(periodOf(1111)?.name).toBe("12th century");
    expect(periodOf(2001)?.name).toBe("21st century");
    expect(periodOf(null)).toBeNull();
  });

  it("builds genre and period affinities", () => {
    const t = buildTaste([
      { ...r("a", "x", 9.5), genres: [landscape], year: 1880 },
      { ...r("b", "y", 9.0), genres: [landscape], year: 1885 },
      { ...r("c", "z", 1.0), genres: [portrait], year: 1650 },
      { ...r("d", "w", 1.5), genres: [portrait], year: 1660 },
    ]);
    expect(t.genres.get("LAND")!.affinity).toBeGreaterThan(0.5);
    expect(t.genres.get("PORT")!.affinity).toBeLessThan(-0.5);
    expect(t.periods.get("C19")!.affinity).toBeGreaterThan(0);
    expect(topNegative(t.genres, 3).map((g) => g.id)).toEqual(["PORT"]);
  });

  it("genre and period move predictions for unseen artists", () => {
    const t = buildTaste([
      { ...r("a", "x", 9.5), genres: [landscape], year: 1880 },
      { ...r("b", "y", 9.0), genres: [landscape], year: 1885 },
      { ...r("c", "z", 1.0), genres: [portrait], year: 1650 },
    ]);
    const land = predictScore({ artistId: "new", movementIds: [], genreIds: ["LAND"], year: 1870 }, t);
    const port = predictScore({ artistId: "new", movementIds: [], genreIds: ["PORT"], year: 1640 }, t);
    expect(land.score).toBeGreaterThan(6);
    expect(port.score).toBeLessThan(4);
    expect(land.confidence).toBe("normal");
    // A century alone is not enough to call it a real prediction.
    expect(predictScore({ artistId: "new", movementIds: [], year: 1870 }, t).confidence).toBe("low");
  });
});

describe("masterpiece term", () => {
  it("rewards confident high predictions and ignores weak or low-confidence ones", () => {
    expect(masterpieceTerm([{ title: "a", predicted: 6.0, confidence: "normal" }])).toBeNull();
    expect(masterpieceTerm([{ title: "a", predicted: 9.9, confidence: "low" }])).toBeNull();
    const t = masterpieceTerm([
      { title: "Starry", predicted: 9.9, confidence: "normal" },
      { title: "Irises", predicted: 9.0, confidence: "normal" },
    ])!;
    expect(t.value).toBeCloseTo(0.5 * (4.9 / 5 + 4 / 5));
    expect(t.text).toBe("Starry (predicted 9.9)");
    expect(t.hidden).toBe(true);
  });

  it("breaks a holdings tie in favour of the museum with the masterpiece, without listing it as a reason", () => {
    const taste = buildTaste([r("a", "monet", 9.5), r("b", "monet", 9.0)]);
    const m1 = museum("plain", [["monet", 10]]);
    const m2 = museum("star", [["monet", 10]]);
    const extra = new Map([["star", [masterpieceTerm([{ title: "Water Lilies", predicted: 9.6, confidence: "normal" as const }])!]]]);
    const res = matchMuseums([m1, m2], taste, { extraTerms: extra });
    expect(res[0].id).toBe("star");
    expect(res[0].reasons).toEqual(["10 by monet"]);
  });
});

describe("queue strategies", () => {
  const c = (id: string, artistId: string, fame: number, movementIds: string[] = [], genreIds: string[] = []) =>
    ({ id, artistId, sitelinks: 10, fame, movementIds, genreIds }) satisfies QueueCandidate;

  it("cold start covers distinct artists before repeating any", () => {
    const ids = pickQueue(
      [c("v1", "vg", 1.0, ["PI"]), c("v2", "vg", 0.99, ["PI"]), c("v3", "vg", 0.98, ["PI"]), c("m1", "mo", 0.5, ["PI"]), c("r1", "ra", 0.4, ["REN"])],
      { rankedCount: 0, taste: buildTaste([]), limit: 3 },
    );
    expect(new Set(ids.map((id) => id[0])).size).toBe(3);
  });

  it("cold start prefers fame over sitelinks", () => {
    const ids = pickQueue(
      [
        { id: "langs", artistId: "a", sitelinks: 90, fame: 0.2, movementIds: ["M"] },
        { id: "views", artistId: "b", sitelinks: 10, fame: 0.9, movementIds: ["M"] },
      ],
      { rankedCount: 0, taste: buildTaste([]), limit: 2 },
    );
    expect(ids[0]).toBe("views");
  });

  it("personalised mix includes unexplored genres and once-ranked artists", () => {
    const taste = buildTaste(
      Array.from({ length: 10 }, (_, i) => ({ ...r(`x${i}`, i === 0 ? "solo" : "fav", 9), genres: [{ id: "LAND", name: "l" }] })),
    );
    const cands = [
      ...Array.from({ length: 30 }, (_, i) => c(`f${i}`, `fav${i % 2}`, 0.5, [], ["LAND"])),
      ...Array.from({ length: 5 }, (_, i) => c(`n${i}`, `other${i}`, 0.5, [], ["STILL"])),
      ...Array.from({ length: 5 }, (_, i) => c(`s${i}`, "solo", 0.5, [], ["LAND"])),
    ];
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const counts = { explore: 0, sharpen: 0 };
    for (let run = 0; run < 20; run++) {
      const ids = pickQueue(cands, { rankedCount: 10, taste, limit: 10, rng });
      counts.explore += ids.filter((id) => id.startsWith("n")).length;
      counts.sharpen += ids.filter((id) => id.startsWith("s")).length;
    }
    // 5 of 40 candidates each (12.5%) would be ~25 per 200 picks by chance; strategies should beat that.
    expect(counts.explore).toBeGreaterThan(30);
    expect(counts.sharpen).toBeGreaterThan(20);
  });
});
