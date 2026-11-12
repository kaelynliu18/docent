import { describe, expect, it } from "vitest";
import { equalAreaSizes } from "@/lib/algo/equalArea";

const area = (s: { w: number; h: number }) => s.w * s.h;

describe("equalAreaSizes", () => {
  const box = { w: 300, h: 300 };
  const wide = { w: 2090, h: 1000 }; // Wheatfield with Crows
  const tall = { w: 785, h: 1000 }; // Wanderer above the Sea of Fog

  it("gives a wide and a tall painting the same area", () => {
    const [a, b] = equalAreaSizes(box, [wide, tall]);
    expect(area(a)).toBeCloseTo(area(b), 6);
  });

  it("never changes a painting's proportions", () => {
    const [a, b] = equalAreaSizes(box, [wide, tall]);
    expect(a.w / a.h).toBeCloseTo(2.09, 6);
    expect(b.w / b.h).toBeCloseTo(0.785, 6);
  });

  it("keeps both inside the box, the limiting one touching an edge", () => {
    const sizes = equalAreaSizes(box, [wide, tall]);
    for (const s of sizes) {
      expect(s.w).toBeLessThanOrEqual(300 + 1e-9);
      expect(s.h).toBeLessThanOrEqual(300 + 1e-9);
    }
    expect(sizes[0].w).toBeCloseTo(300, 6); // the wide one sets the shared area
  });

  it("never upscales past an image's own pixels", () => {
    const tiny = { w: 100, h: 80 };
    const [a, b] = equalAreaSizes(box, [tiny, tall]);
    expect(area(a)).toBeCloseTo(8000, 6);
    expect(area(b)).toBeCloseTo(8000, 6);
  });

  it("handles missing sizes and empty boxes", () => {
    expect(equalAreaSizes({ w: 0, h: 100 }, [wide])).toEqual([{ w: 0, h: 0 }]);
    const [s] = equalAreaSizes(box, [{ w: 0, h: 0 }]);
    expect(s.w).toBeCloseTo(300, 6); // unknown shape treated as square
  });
});
