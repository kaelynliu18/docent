/**
 * Size paintings so each covers the same screen area, keeping every
 * painting's exact proportions (never stretched or cropped). Used where two
 * paintings are compared, so a painting's shape can't make it look bigger.
 *
 * The shared area is the largest that lets every painting still fit its box,
 * and never more than an image's own pixels (no blurry upscaling).
 */
export type Size = { w: number; h: number };

export function equalAreaSizes(box: Size, images: Size[]): Size[] {
  if (!images.length || box.w <= 0 || box.h <= 0) return images.map(() => ({ w: 0, h: 0 }));
  const ratios = images.map((im) => (im.w > 0 && im.h > 0 ? im.w / im.h : 1));
  // Area each painting would get if fitted alone, and its native pixel area.
  const limits = images.map((im, i) => {
    const r = ratios[i];
    const fit = box.w / box.h > r ? { w: box.h * r, h: box.h } : { w: box.w, h: box.w / r };
    const native = im.w > 0 && im.h > 0 ? im.w * im.h : Infinity;
    return Math.min(fit.w * fit.h, native);
  });
  const area = Math.min(...limits);
  return ratios.map((r) => ({ w: Math.sqrt(area * r), h: Math.sqrt(area / r) }));
}
