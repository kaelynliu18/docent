/**
 * Realistic "phone photo of a painting" distortions on raw RGBA pixels, for the
 * photo-recognition eval. Pure and seeded; no image libraries.
 */
export type Img = { data: Uint8ClampedArray; width: number; height: number };

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function sample(img: Img, x: number, y: number): [number, number, number] {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const o = (yi * img.width + xi) * 4;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

function blank(width: number, height: number, rgb: [number, number, number] = [0, 0, 0]): Img {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { data, width, height };
}

/** Keep the centre `frac` of each side. */
export function centerCrop(img: Img, frac: number): Img {
  return crop(img, (1 - frac) / 2, (1 - frac) / 2, frac, frac);
}

export function crop(img: Img, fx: number, fy: number, fw: number, fh: number): Img {
  const w = Math.max(1, Math.round(img.width * fw));
  const h = Math.max(1, Math.round(img.height * fh));
  const out = blank(w, h);
  const x0 = img.width * fx, y0 = img.height * fy;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.data.set([...sample(img, x0 + x, y0 + y), 255], (y * w + x) * 4);
  return out;
}

export function brightness(img: Img, k: number): Img {
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) data[i + c] = clamp(data[i + c] * k);
  return { ...img, data };
}

/** Box blur, two passes (≈ Gaussian). */
export function blur(img: Img, r: number): Img {
  let cur = img;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Uint8ClampedArray(cur.data.length);
    for (let y = 0; y < cur.height; y++)
      for (let x = 0; x < cur.width; x++) {
        let s0 = 0, s1 = 0, s2 = 0, n = 0;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const [a, b, c] = sample(cur, x + dx, y + dy);
            s0 += a;
            s1 += b;
            s2 += c;
            n++;
          }
        out.set([s0 / n, s1 / n, s2 / n, 255], (y * cur.width + x) * 4);
      }
    cur = { ...cur, data: out };
  }
  return cur;
}

/** A bright reflection from a spotlight: radial white highlight at (cx, cy) in 0–1. */
export function glare(img: Img, cx: number, cy: number, radius: number, strength: number): Img {
  const data = new Uint8ClampedArray(img.data);
  const R = radius * Math.max(img.width, img.height);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const d = Math.hypot(x - cx * img.width, y - cy * img.height) / R;
      if (d >= 1) continue;
      const a = strength * (1 - d) ** 2;
      const o = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = clamp(data[o + c] * (1 - a) + 255 * a);
    }
  return { ...img, data };
}

/** Photographed from off-centre: keystone (top narrower by `keystone`) plus a small rotation. */
export function perspective(img: Img, keystone: number, rotateDeg: number, wall: [number, number, number] = [214, 208, 198]): Img {
  const { width: w, height: h } = img;
  const out = blank(w, h, wall);
  const t = (rotateDeg * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Undo rotation about the centre, then undo the keystone (row-dependent horizontal scale).
      const dx = x - w / 2, dy = y - h / 2;
      const rx = cos * dx + sin * dy + w / 2;
      const ry = -sin * dx + cos * dy + h / 2;
      const scale = 1 - keystone * (1 - ry / h);
      const sx = (rx - w / 2) / scale + w / 2;
      if (sx < 0 || sx >= w || ry < 0 || ry >= h) continue;
      out.data.set([...sample(img, sx, ry), 255], (y * w + x) * 4);
    }
  return out;
}

/** Hung on a wall: a dark frame (frac of the short side) inside a wall margin. */
export function frameOnWall(img: Img, frame = 0.05, margin = 0.25, wall: [number, number, number] = [222, 216, 205]): Img {
  const f = Math.round(Math.min(img.width, img.height) * frame);
  const m = Math.round(Math.min(img.width, img.height) * margin);
  const W = img.width + 2 * (f + m), H = img.height + 2 * (f + m);
  const out = blank(W, H, wall);
  for (let y = m; y < H - m; y++) for (let x = m; x < W - m; x++) out.data.set([58, 42, 30, 255], (y * W + x) * 4);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      out.data.set([img.data[o], img.data[o + 1], img.data[o + 2], 255], ((y + m + f) * W + (x + m + f)) * 4);
    }
  return out;
}

export const DISTORTIONS: Record<string, (img: Img) => Img> = {
  none: (i) => i,
  "perspective + tilt": (i) => perspective(i, 0.18, 5),
  glare: (i) => glare(i, 0.62, 0.32, 0.35, 0.75),
  blur: (i) => blur(i, 2),
  "partial crop": (i) => crop(i, 0.08, 0.12, 0.72, 0.7),
  "dim gallery light": (i) => brightness(i, 0.55),
  "frame + wall": (i) => frameOnWall(i),
  "realistic (frame, wall, tilt, dim, glare)": (i) => glare(brightness(perspective(frameOnWall(i, 0.05, 0.15), 0.12, 3), 0.7), 0.6, 0.35, 0.3, 0.5),
};
