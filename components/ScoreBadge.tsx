import type { Tier } from "@/lib/algo/types";

const TIER_BG: Record<Tier, string> = { loved: "bg-loved", fine: "bg-fine", meh: "bg-meh" };

/** Real scores are filled; predictions are outlined and say so. */
export function ScoreBadge({
  score,
  tier,
  predicted = false,
  lowConfidence = false,
  size = "md",
}: {
  score: number;
  tier?: Tier;
  predicted?: boolean;
  lowConfidence?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const dims = size === "lg" ? "h-12 min-w-12 text-lg" : size === "sm" ? "h-7 min-w-9 text-xs" : "h-9 min-w-11 text-sm";
  const label = predicted
    ? `Predicted ${score.toFixed(1)} out of 10${lowConfidence ? ", low confidence" : ""}`
    : `Your score ${score.toFixed(1)} out of 10`;
  if (predicted) {
    return (
      <span
        title={label}
        aria-label={label}
        className={`inline-flex items-center justify-center rounded-full border-[1.5px] border-dashed border-ink-2 px-2 font-semibold tabular-nums text-ink ${dims} ${lowConfidence ? "opacity-60" : ""}`}
      >
        {score.toFixed(1)}
      </span>
    );
  }
  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center rounded-full px-2 font-semibold tabular-nums text-accent-ink ${tier ? TIER_BG[tier] : "bg-accent"} ${dims}`}
    >
      {score.toFixed(1)}
    </span>
  );
}
