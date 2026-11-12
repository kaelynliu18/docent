import { describe, expect, it } from "vitest";
import { buildTaste, topNegative } from "@/lib/algo/taste";
import { predictScore } from "@/lib/algo/predict";
import { parseNudity } from "@/lib/ingest/parse";
import { NUDITY_GENRE_RE, NUDITY_LABEL_RE } from "@/lib/ingest/queries";
import type { RankedForTaste } from "@/lib/algo/types";

const r = (id: string, artistId: string, score: number, tags: string[] = [], genre = "G1"): RankedForTaste => ({
  artworkId: id,
  artistId,
  artistName: artistId,
  score,
  movements: [],
  genres: [{ id: genre, name: genre }],
  year: 1870,
  tags,
});

describe("content dimension (nudity)", () => {
  // Likes these artists and genres, but ranks their nude paintings low.
  const ranked = [
    r("a", "Manet", 9), r("b", "Manet", 2, ["nudity"]),
    r("c", "Titian", 8.5, [], "G2"), r("d", "Titian", 1.5, ["nudity"], "G2"),
    r("e", "Courbet", 1, ["nudity"], "G3"),
  ];
  const taste = buildTaste(ranked);

  it("learns a dislike that cuts across artists and genres", () => {
    const nudity = taste.content.get("nudity")!;
    expect(nudity.count).toBe(3);
    expect(nudity.affinity).toBeLessThan(-0.8);
    expect(topNegative(taste.content, 1)[0].name).toBe("Nudity");
  });

  it("pulls a nude by a liked artist below the same artist's other work", () => {
    const clothed = predictScore({ artistId: "Manet", movementIds: [], genreIds: ["G1"], year: 1870 }, taste);
    const nude = predictScore({ artistId: "Manet", movementIds: [], genreIds: ["G1"], year: 1870, tags: ["nudity"] }, taste);
    expect(nude.score).toBeLessThan(clothed.score - 1);
  });

  it("counts even for unknown artists, and ignores unknown tags", () => {
    const t = buildTaste([r("x", "X0", 1, ["nudity"]), r("y", "X0", 1, ["nudity", "made-up"])]);
    expect(t.content.get("nudity")?.count).toBe(2);
    expect(t.content.has("made-up")).toBe(false);
    expect(t.artists.size).toBe(0);
  });
});

describe("nudity data", () => {
  it("parses depicts results and matches the right labels and genres", () => {
    const ids = parseNudity([{ p: { type: "uri", value: "http://www.wikidata.org/entity/Q151047" } }, { p: { type: "uri", value: "junk" } }]);
    expect([...ids]).toEqual(["Q151047"]);
    const re = new RegExp(NUDITY_LABEL_RE, "i");
    for (const l of ["nudity", "naked woman", "clothed male, naked female", "male nudity", "breast", "nude"]) expect(re.test(l)).toBe(true);
    for (const l of ["breastfeeding", "Virgin Mary", "landscape"]) expect(re.test(l)).toBe(false);
    expect(NUDITY_GENRE_RE.test("erotic art")).toBe(true);
    expect(NUDITY_GENRE_RE.test("nude self-portrait")).toBe(true);
    expect(NUDITY_GENRE_RE.test("portrait")).toBe(false);
  });
});
