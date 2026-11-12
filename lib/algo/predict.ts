import { periodOf } from "./taste";
import type { ArtworkFeatures, TasteProfile } from "./types";

export type Prediction = { score: number; confidence: "low" | "normal" };

/** Weight of each dimension inside the tanh. Artist is the strongest signal. */
export const PREDICT_WEIGHTS = { artist: 1, movement: 0.5, genre: 0.35, period: 0.2 };
/**
 * Scales z before tanh. With four dimensions a strong match reaches z≈3, which
 * would pin every good prediction at 10.0; 0.6 keeps them distinguishable
 * (~9.8). Monotone, so it never changes the order of predictions.
 */
export const PREDICT_SCALE = 0.6;

const mean = (ids: string[], m: TasteProfile["movements"]) =>
  ids.length ? ids.reduce((s, id) => s + (m.get(id)?.affinity ?? 0), 0) / ids.length : 0;

/**
 * 6.4, extended: ŝ = 5 + 5·tanh(0.6·(A_k + 0.5·M̄ + 0.35·Ḡ + 0.2·P)).
 * Unknown dimensions contribute 0; tanh keeps it inside 0–10.
 * "low" confidence when neither the artist, a movement nor a genre has been ranked
 * (a century alone is too weak to call it a real prediction).
 */
export function predictScore(
  art: ArtworkFeatures,
  taste: TasteProfile,
  weights: typeof PREDICT_WEIGHTS = PREDICT_WEIGHTS,
): Prediction {
  const genreIds = art.genreIds ?? [];
  const a = taste.artists.get(art.artistId);
  const period = periodOf(art.year);
  const p = period ? taste.periods.get(period.id) : undefined;
  const z =
    weights.artist * (a?.affinity ?? 0) +
    weights.movement * mean(art.movementIds, taste.movements) +
    weights.genre * mean(genreIds, taste.genres) +
    weights.period * (p?.affinity ?? 0);
  const knows =
    !!a || art.movementIds.some((id) => taste.movements.has(id)) || genreIds.some((id) => taste.genres.has(id));
  return { score: 5 + 5 * Math.tanh(PREDICT_SCALE * z), confidence: knows ? "normal" : "low" };
}
