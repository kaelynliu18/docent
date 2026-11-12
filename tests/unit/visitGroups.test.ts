import { describe, expect, it } from "vitest";
import { distanceKm, groupPhotos, localDay } from "@/lib/algo/visitGroups";

const orsay = { lat: 48.86, lon: 2.3266 };
const louvre = { lat: 48.8606, lon: 2.3376 }; // ~0.8 km from Orsay
const prado = { lat: 40.4138, lon: -3.6921 };

describe("groupPhotos", () => {
  it("splits by day and by place", () => {
    const g = groupPhotos([
      { id: "a", day: "2026-11-06", ...orsay },
      { id: "b", day: "2026-11-06", lat: orsay.lat + 0.001, lon: orsay.lon },
      { id: "c", day: "2026-10-01", ...prado },
    ]);
    expect(g).toEqual([
      { day: "2026-11-06", lat: expect.any(Number), lon: expect.any(Number), ids: ["a", "b"] },
      { day: "2026-10-01", ...prado, ids: ["c"] },
    ]);
  });

  it("keeps two museums visited the same day apart when far enough", () => {
    const g = groupPhotos([{ id: "a", day: "2026-11-06", ...orsay }, { id: "b", day: "2026-11-06", ...prado }]);
    expect(g).toHaveLength(2);
    // Orsay and the Louvre are 0.8 km apart: one group at 1 km, two at 0.5 km.
    expect(groupPhotos([{ id: "a", day: "d", ...orsay }, { id: "b", day: "d", ...louvre }])).toHaveLength(1);
    expect(groupPhotos([{ id: "a", day: "d", ...orsay }, { id: "b", day: "d", ...louvre }], 0.5)).toHaveLength(2);
  });

  it("puts photos without GPS with their day's only place, or on their own", () => {
    const one = groupPhotos([
      { id: "a", day: "2026-11-06", ...orsay },
      { id: "b", day: "2026-11-06", lat: null, lon: null },
    ]);
    expect(one).toHaveLength(1);
    expect(one[0].ids).toEqual(["a", "b"]);

    const two = groupPhotos([
      { id: "a", day: "2026-11-06", ...orsay },
      { id: "b", day: "2026-11-06", ...prado },
      { id: "c", day: "2026-11-06", lat: null, lon: null },
    ]);
    expect(two).toHaveLength(3);
    expect(two.find((g) => g.lat == null)!.ids).toEqual(["c"]);
  });

  it("groups undated photos last", () => {
    const g = groupPhotos([{ id: "a", day: null, lat: null, lon: null }, { id: "b", day: "2026-01-01", lat: null, lon: null }]);
    expect(g.map((x) => x.day)).toEqual(["2026-01-01", null]);
  });

  it("distance and local day helpers", () => {
    expect(distanceKm(orsay, louvre)).toBeGreaterThan(0.7);
    expect(distanceKm(orsay, louvre)).toBeLessThan(0.9);
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
