import { SCAN } from "./config";

export type ScanHit = { id: string; score: number };

/**
 * Photo → catalogue matches. When we know the museum (a visit), its paintings
 * come first: if its best match reaches SCAN.museumMin we show the museum's top
 * matches, otherwise the whole catalogue's.
 *
 * Confidence is judged on the whole catalogue, never the museum's short list
 * (few candidates make any match look unique): a match counts as found only if
 * the catalogue's best is very close (≥ SCAN.foundScore) or clearly ahead of the
 * runner-up (gap ≥ SCAN.foundGap). Otherwise "not a confident match", and the
 * closest few are still shown so the person can pick or search.
 */
export function pickMatches(
  museum: ScanHit[] | null,
  global: ScanHit[],
  opts: { museumMin?: number; foundScore?: number; foundGap?: number; show?: number } = {},
) {
  const { museumMin = SCAN.museumMin, foundScore = SCAN.foundScore, foundGap = SCAN.foundGap, show = SCAN.show } = opts;
  const fromMuseum = !!museum && (museum[0]?.score ?? -1) >= museumMin;
  const list = fromMuseum ? museum! : global;
  const top = global[0]?.score ?? 0;
  const gap = top - (global[1]?.score ?? 0);
  const found = global.length > 0 && (top >= foundScore || gap >= foundGap);
  return { matches: list.slice(0, show), fromMuseum, notFound: !found };
}
