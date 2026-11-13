import { describe, expect, it } from "vitest";
import { pickMatches } from "@/lib/algo/scan";

const hits = (...xs: [string, number][]) => xs.map(([id, score]) => ({ id, score }));
const o = { museumMin: 0.62, margin: 0.016, show: 5 };

describe("pickMatches", () => {
  it("prefers the visited museum when its best match is good", () => {
    const r = pickMatches(hits(["m1", 0.8], ["m2", 0.7]), hits(["g1", 0.85], ["m1", 0.8]), o);
    expect(r).toMatchObject({ fromMuseum: true, notFound: false });
    expect(r.matches.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("falls back to the whole catalogue when the museum has nothing close", () => {
    const r = pickMatches(hits(["m1", 0.4]), hits(["g1", 0.75], ["g2", 0.7]), { ...o, show: 1 });
    expect(r).toMatchObject({ fromMuseum: false, notFound: false });
    expect(r.matches.map((m) => m.id)).toEqual(["g1"]);
  });

  it("says not found when nothing stands out, but still offers the closest", () => {
    const r = pickMatches(null, hits(["g1", 0.79], ["g2", 0.785], ["g3", 0.78]), o);
    expect(r.notFound).toBe(true);
    expect(r.matches).toHaveLength(3);
  });
});
