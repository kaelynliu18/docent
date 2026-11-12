import { SCAN } from "./config";

export type ScanHit = { id: string; score: number };

/**
 * Photo → catalogue matches. When we know the museum (a visit), its paintings
 * come first: if its best match clears the threshold we show the museum's top
 * matches, otherwise the whole catalogue's. Below the threshold everywhere we
 * say "not found" (and the UI offers text search), but still return the
 * closest few so a near miss can be picked.
 */
export function pickMatches(museum: ScanHit[] | null, global: ScanHit[], threshold = SCAN.notFoundBelow, show = SCAN.show) {
  const museumBest = museum?.[0]?.score ?? -1;
  const fromMuseum = !!museum && museumBest >= threshold;
  const list = fromMuseum ? museum! : global;
  const best = Math.max(museumBest, global[0]?.score ?? -1);
  return { matches: list.slice(0, show), fromMuseum, notFound: best < threshold };
}
