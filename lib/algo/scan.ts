import { SCAN } from "./config";

export type ScanHit = { id: string; score: number };

/**
 * Photo → catalogue matches. When we know the museum (a visit), its paintings
 * come first: if its best match reaches SCAN.museumMin we show the museum's top
 * matches, otherwise the whole catalogue's. "Not found" when the best match
 * isn't clearly ahead of the runner-up (margin below SCAN.notFoundMargin):
 * CLIP finds most paintings similar, so a lone strong match is the signal, not
 * a high score. The closest few are returned either way so the person can pick.
 */
export function pickMatches(
  museum: ScanHit[] | null,
  global: ScanHit[],
  opts: { museumMin?: number; margin?: number; show?: number } = {},
) {
  const { museumMin = SCAN.museumMin, margin = SCAN.notFoundMargin, show = SCAN.show } = opts;
  const fromMuseum = !!museum && (museum[0]?.score ?? -1) >= museumMin;
  const list = fromMuseum ? museum! : global;
  const gap = (list[0]?.score ?? 0) - (list[1]?.score ?? 0);
  return { matches: list.slice(0, show), fromMuseum, notFound: list.length === 0 || gap < margin };
}
