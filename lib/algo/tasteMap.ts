import { MAP } from "./config";

/**
 * "Unexplored regions" on the taste map: clusters that hold a real share of
 * the catalogue (≥ MAP.unexploredMinShare) but none of this person's
 * rankings, biggest first. Each links to recommendations from that region.
 */
export function unexploredClusters(
  clusters: { cluster: number; label: string; size: number; x: number; y: number }[],
  rankedClusters: Iterable<number>,
  catalogueSize: number,
  minShare = MAP.unexploredMinShare,
) {
  const mine = new Set(rankedClusters);
  return clusters
    .filter((c) => !mine.has(c.cluster) && c.size >= catalogueSize * minShare)
    .sort((a, b) => b.size - a.size);
}
