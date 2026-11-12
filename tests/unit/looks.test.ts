import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { cleanMoods, colorStats, lookTags } from "@/lib/algo/look";
import { buildTaste } from "@/lib/algo/taste";
import { PREDICT_WEIGHTS, artistAffinity, predictScore } from "@/lib/algo/predict";
import { PERSONAL_MIN_RANKINGS, learnWeights } from "@/lib/algo/personal";
import { explainPrediction, explanationText } from "@/lib/algo/explain";
import { decodeImage } from "@/lib/ingest/looks";
import type { RankedForTaste } from "@/lib/algo/types";

const rgb = (...px: [number, number, number][]) => px.flat();

describe("colorStats", () => {
  it("measures warmth, brightness and saturation", () => {
    const red = colorStats(rgb([255, 0, 0], [255, 0, 0]), 3);
    expect(red.warmth).toBeCloseTo(1);
    expect(red.saturation).toBeCloseTo(1);
    expect(red.brightness).toBeCloseTo(0.2126);
    expect(red.contrast).toBeCloseTo(0);
    const blue = colorStats(rgb([0, 0, 255]), 3);
    expect(blue.warmth).toBeCloseTo(-1);
    const grey = colorStats(rgb([0, 0, 0], [255, 255, 255]), 3);
    expect(grey.saturation).toBe(0);
    expect(grey.brightness).toBeCloseTo(0.5);
    expect(grey.contrast).toBeCloseTo(0.5);
  });

  it("reads RGBA and ignores alpha", () => {
    expect(colorStats([255, 0, 0, 0, 255, 0, 0, 255], 4).warmth).toBeCloseTo(1);
  });

  it("decodes a PNG thumbnail", () => {
    const png = new PNG({ width: 2, height: 1 });
    png.data.set([200, 120, 40, 255, 200, 120, 40, 255]);
    const img = decodeImage(new Uint8Array(PNG.sync.write(png)), "image/png")!;
    const s = colorStats(img.px, img.channels);
    expect(s.warmth).toBeGreaterThan(0.5);
    expect(lookTags(s)).toContain("warm");
  });
});

describe("lookTags and cleanMoods", () => {
  it("leaves the middle of each scale untagged", () => {
    expect(lookTags({ warmth: 0.1, brightness: 0.33, saturation: 0.4, contrast: 0.2 })).toEqual([]);
    expect(lookTags({ warmth: 0.3, brightness: 0.2, saturation: 0.6, contrast: 0.2 })).toEqual(["warm", "dark", "vivid"]);
    expect(lookTags(null)).toEqual([]);
  });

  it("keeps only known moods, deduplicated, at most three", () => {
    expect(cleanMoods(["Serene", "serene", "angry", "eerie", "joyful", "dramatic"])).toEqual(["serene", "eerie", "joyful"]);
  });
});

const row = (id: string, score: number, o: Partial<RankedForTaste> = {}): RankedForTaste => ({
  artworkId: id,
  artistId: o.artistId ?? `A${id}`,
  artistName: o.artistName ?? `Artist ${id}`,
  score,
  movements: [],
  genres: [],
  year: 1900,
  ...o,
});

describe("mood and colour in taste", () => {
  const ranked = [
    row("1", 9.5, { moods: ["serene"], looks: ["cool"] }),
    row("2", 9.0, { moods: ["serene"], looks: ["cool"] }),
    row("3", 2.0, { moods: ["dramatic"], looks: ["warm"] }),
    row("4", 1.5, { moods: ["dramatic"], looks: ["warm"] }),
  ];
  const taste = buildTaste(ranked);

  it("predicts an unseen artist's painting from mood and colour alone", () => {
    const calm = predictScore({ artistId: "new", movementIds: [], moods: ["serene"], looks: ["cool"] }, taste);
    const loud = predictScore({ artistId: "new", movementIds: [], moods: ["dramatic"], looks: ["warm"] }, taste);
    expect(calm.score).toBeGreaterThan(6);
    expect(loud.score).toBeLessThan(4);
    expect(calm.confidence).toBe("normal");
  });

  it("explains a mood-driven prediction in plain words", () => {
    const art = { artistId: "new", movementIds: [], moods: ["serene"] };
    const text = explanationText(explainPrediction(art, taste, ranked.map((r) => ({ ...r, id: r.artworkId, title: `Painting ${r.artworkId}`, movementIds: [] }))));
    expect(text).toBe("You tend to love serene paintings, like Painting 1 and Painting 2.");
  });
});

describe("artist phases", () => {
  const pablo = { artistId: "P", artistName: "Picasso" };
  const ranked = [
    row("blue1", 2.0, { ...pablo, year: 1902 }),
    row("blue2", 2.5, { ...pablo, year: 1903 }),
    row("cub1", 9.5, { ...pablo, year: 1910 }),
    row("cub2", 9.0, { ...pablo, year: 1911 }),
    row("cub3", 9.2, { ...pablo, year: 1912 }),
  ];
  const taste = buildTaste(ranked);

  it("equals the overall artist affinity when all rankings share a year", () => {
    const same = buildTaste([row("a", 9, { ...pablo, year: 1910 }), row("b", 3, { ...pablo, year: 1910 })]);
    expect(artistAffinity("P", 1910, same)).toBeCloseTo(same.artists.get("P")!.affinity);
  });

  it("predicts a Blue Period painting lower than a Cubist one", () => {
    const blue = predictScore({ ...pablo, movementIds: [], year: 1902 }, taste).score;
    const cubist = predictScore({ ...pablo, movementIds: [], year: 1911 }, taste).score;
    expect(cubist - blue).toBeGreaterThan(1.5);
    // Without phases every Picasso gets the same, mostly-loved artist score.
    const noPhase = predictScore({ ...pablo, movementIds: [], year: 1902 }, { ...taste, artistWorks: new Map() }).score;
    expect(blue).toBeLessThan(noPhase - 1);
  });

  it("falls back to the overall affinity without a year", () => {
    expect(artistAffinity("P", null, taste)).toBeCloseTo(taste.artists.get("P")!.affinity);
  });
});

describe("learnWeights", () => {
  it("keeps the defaults until enough has been ranked", () => {
    const few = Array.from({ length: PERSONAL_MIN_RANKINGS - 1 }, (_, i) => row(String(i), 5 + (i % 5)));
    expect(learnWeights(few)).toBe(PREDICT_WEIGHTS);
  });

  it("raises the mood weight for someone who ranks by mood, not artist", () => {
    const moods = ["serene", "joyful", "eerie", "dramatic"];
    const like: Record<string, number> = { serene: 9.4, joyful: 7.5, eerie: 3.5, dramatic: 1.5 };
    // 40 paintings, every artist different, score set by mood.
    const ranked = Array.from({ length: 40 }, (_, i) => {
      const m = moods[i % 4];
      return row(String(i), like[m] + ((i * 7) % 5) / 10 - 0.2, { moods: [m] });
    });
    const w = learnWeights(ranked);
    expect(w.mood).toBeGreaterThan(PREDICT_WEIGHTS.mood);
    for (const v of Object.values(w)) expect(v).toBeGreaterThanOrEqual(0);
  });
});
