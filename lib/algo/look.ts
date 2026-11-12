/**
 * What a painting looks and feels like, from the image itself rather than
 * Wikidata: colour (measured from pixels) and mood (tagged once per painting).
 * Both become tags that taste learns like any other trait, so "warm, muted,
 * serene" can predict a painting by an artist you've never ranked.
 */

/** Averages over a downscaled image. All in 0–1 except warmth (−1 cool … +1 warm). */
export type ColorStats = { warmth: number; brightness: number; saturation: number; contrast: number };

/**
 * Pixels as a flat RGB or RGBA byte array (alpha ignored).
 * warmth = mean(r − b), brightness = mean luma, saturation = mean HSV saturation,
 * contrast = standard deviation of luma.
 */
export function colorStats(px: ArrayLike<number>, channels: 3 | 4): ColorStats {
  const n = Math.floor(px.length / channels);
  if (n === 0) throw new RangeError("no pixels");
  let warm = 0, lum = 0, lum2 = 0, sat = 0;
  for (let i = 0; i < n; i++) {
    const r = px[i * channels] / 255, g = px[i * channels + 1] / 255, b = px[i * channels + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    warm += r - b;
    lum += l;
    lum2 += l * l;
    sat += max === 0 ? 0 : (max - min) / max;
  }
  const brightness = lum / n;
  return {
    warmth: warm / n,
    brightness,
    saturation: sat / n,
    contrast: Math.sqrt(Math.max(0, lum2 / n - brightness * brightness)),
  };
}

/** Colour tags the app knows how to name. */
export const LOOK_TAGS: Record<string, string> = {
  warm: "Warm colours",
  cool: "Cool colours",
  bright: "Light",
  dark: "Dark",
  vivid: "Vivid colour",
  muted: "Muted colour",
};

/**
 * Terciles of the 1,579 measured pool paintings (pnpm looks colors --seed, Nov 2026):
 * the middle third of each scale gets no tag, so each tag marks a real third.
 */
export const LOOK_CUTS = {
  warmth: { cool: 0.078, warm: 0.132 },
  brightness: { dark: 0.283, bright: 0.391 },
  saturation: { muted: 0.343, vivid: 0.456 },
};

export function lookTags(s: ColorStats | null | undefined): string[] {
  if (!s) return [];
  const t: string[] = [];
  if (s.warmth >= LOOK_CUTS.warmth.warm) t.push("warm");
  else if (s.warmth <= LOOK_CUTS.warmth.cool) t.push("cool");
  if (s.brightness >= LOOK_CUTS.brightness.bright) t.push("bright");
  else if (s.brightness <= LOOK_CUTS.brightness.dark) t.push("dark");
  if (s.saturation >= LOOK_CUTS.saturation.vivid) t.push("vivid");
  else if (s.saturation <= LOOK_CUTS.saturation.muted) t.push("muted");
  return t;
}

/** The fixed mood vocabulary. A painting gets 1–3 of these. */
export const MOODS: Record<string, string> = {
  serene: "Serene",
  joyful: "Joyful",
  melancholy: "Melancholy",
  dramatic: "Dramatic",
  eerie: "Eerie",
  intimate: "Intimate",
  energetic: "Energetic",
};

/** Drops anything outside the vocabulary and duplicates; keeps at most 3. */
export function cleanMoods(xs: readonly string[] | null | undefined): string[] {
  return [...new Set((xs ?? []).map((x) => x.toLowerCase()).filter((x) => x in MOODS))].slice(0, 3);
}
