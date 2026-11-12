import { periodOf } from "./taste";
import type { ArtworkFeatures, TasteProfile } from "./types";

export type Prediction = { score: number; confidence: "low" | "normal" };

/**
 * Weight of each trait inside the tanh: the defaults everyone starts with.
 * Artist is the strongest signal; look (colour) and mood come from the image.
 * Once someone has ranked enough, learnWeights (personal.ts) replaces these
 * with weights fitted to their own rankings.
 */
export const PREDICT_WEIGHTS = { artist: 1, movement: 0.5, genre: 0.35, period: 0.2, content: 0.6, look: 0.15, mood: 0.25 };
export type Weights = typeof PREDICT_WEIGHTS;
export type TermName = keyof Weights;
export const TERM_NAMES = Object.keys(PREDICT_WEIGHTS) as TermName[];

/**
 * Scales z before tanh. With several traits a strong match reaches z≈3, which
 * would pin every good prediction at 10.0; 0.6 keeps them distinguishable
 * (~9.8). Monotone, so it never changes the order of predictions.
 */
export const PREDICT_SCALE = 0.6;

/**
 * Artists change. Rankings of the same artist count less the further apart in
 * time they are: a painting from the same year counts fully, one 4 years away
 * half, 8 years a quarter. Tuned with pnpm eval:algo (docs/decisions.md).
 */
export const PHASE_HALF_LIFE_YEARS = 4;
/** How strongly the artist's overall affinity anchors the era-weighted one (in paintings' worth). */
export const PHASE_PRIOR = 1;

const meanOf = (ids: readonly string[], m: Map<string, { affinity: number }>) =>
  ids.length ? ids.reduce((s, id) => s + (m.get(id)?.affinity ?? 0), 0) / ids.length : 0;

/**
 * Affinity for the painting's artist at the painting's point in their career.
 * Same Σw/√count rule as everywhere, with each ranked painting counted by how
 * close in time it is (k = 0.5^(|Δyear| / half-life)), then blended with the
 * artist's overall affinity so one nearby painting can't decide a decade.
 * If every ranked painting is from the same year this equals the overall affinity.
 */
export function artistAffinity(artistId: string, year: number | null | undefined, taste: TasteProfile): number | undefined {
  const overall = taste.artists.get(artistId);
  if (!overall) return undefined;
  const works = taste.artistWorks?.get(artistId);
  if (year == null || !works?.length) return overall.affinity;
  let k = 0, kw = 0;
  for (const x of works) {
    if (x.year == null) continue;
    const kk = 0.5 ** (Math.abs(x.year - year) / PHASE_HALF_LIFE_YEARS);
    k += kk;
    kw += kk * x.w;
  }
  if (k === 0) return overall.affinity;
  const phase = kw / Math.sqrt(k);
  return (k * phase + PHASE_PRIOR * overall.affinity) / (k + PHASE_PRIOR);
}

/** Each trait's affinity for this painting, before weighting. Unknown traits are 0. */
export function predictionTerms(art: ArtworkFeatures, taste: TasteProfile): Record<TermName, number> {
  const period = periodOf(art.year);
  return {
    artist: artistAffinity(art.artistId, art.year, taste) ?? 0,
    movement: meanOf(art.movementIds, taste.movements),
    genre: meanOf(art.genreIds ?? [], taste.genres),
    period: period ? (taste.periods.get(period.id)?.affinity ?? 0) : 0,
    content: (art.tags ?? []).reduce((s, t) => s + (taste.content.get(t)?.affinity ?? 0), 0),
    look: meanOf(art.looks ?? [], taste.looks ?? new Map()),
    mood: meanOf(art.moods ?? [], taste.moods ?? new Map()),
  };
}

/**
 * ŝ = 5 + 5·tanh(0.6·z), z = Σ weight × trait affinity (the person's own
 * weights when the taste carries them, else the defaults) over artist (era-aware),
 * movement, genre, century, content (e.g. nudity), look (colour) and mood.
 * tanh keeps it inside 0–10.
 * "low" confidence when nothing specific is known: no artist, movement, genre
 * or mood has been ranked (a century or colour alone is too weak to call it a
 * real prediction).
 */
export function predictScore(
  art: ArtworkFeatures,
  taste: TasteProfile,
  weights: Partial<Weights> = taste.weights ?? PREDICT_WEIGHTS,
): Prediction {
  const t = predictionTerms(art, taste);
  let z = 0;
  for (const name of TERM_NAMES) z += (weights[name] ?? 0) * t[name];
  const knows =
    taste.artists.has(art.artistId) ||
    art.movementIds.some((id) => taste.movements.has(id)) ||
    (art.genreIds ?? []).some((id) => taste.genres.has(id)) ||
    (art.moods ?? []).some((id) => taste.moods?.has(id));
  return { score: 5 + 5 * Math.tanh(PREDICT_SCALE * z), confidence: knows ? "normal" : "low" };
}
