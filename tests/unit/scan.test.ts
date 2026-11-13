import { describe, expect, it } from "vitest";
import { pickMatches } from "@/lib/algo/scan";

const hits = (...xs: [string, number][]) => xs.map(([id, score]) => ({ id, score }));
const o = { museumMin: 0.62, foundScore: 0.9, foundGap: 0.04, show: 5 };

describe("pickMatches", () => {
  it("prefers the visited museum when its best match is good", () => {
    const r = pickMatches(hits(["m1", 0.93], ["m2", 0.7]), hits(["m1", 0.93], ["g1", 0.8]), o);
    expect(r).toMatchObject({ fromMuseum: true, notFound: false });
    expect(r.matches.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("falls back to the whole catalogue when the museum has nothing close", () => {
    const r = pickMatches(hits(["m1", 0.4]), hits(["g1", 0.86], ["g2", 0.7]), { ...o, show: 1 });
    expect(r).toMatchObject({ fromMuseum: false, notFound: false });
    expect(r.matches.map((m) => m.id)).toEqual(["g1"]);
  });

  it("judges confidence catalogue-wide, not on the museum's short list", () => {
    // The real failure: a painting missing from the catalogue looked unique inside MoMA's
    // 52 paintings (gap 0.029) and catalogue-wide (gap 0.025), but neither is a strong signal.
    const museum = hits(["samovar", 0.835], ["pails", 0.806]);
    const global = hits(["samovar", 0.835], ["horses", 0.81], ["pails", 0.806]);
    expect(pickMatches(museum, global, o).notFound).toBe(true);
  });

  it("calls a very close match found even among look-alikes", () => {
    expect(pickMatches(null, hits(["a", 0.94], ["b", 0.93]), o).notFound).toBe(false);
  });
});
