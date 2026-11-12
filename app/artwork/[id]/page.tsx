import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getArtworkPage } from "@/lib/server/data";
import { TIER_LABEL } from "@/lib/algo/types";
import { WallLabel } from "@/components/WallLabel";
import { ScoreBadge } from "@/components/ScoreBadge";

export const dynamic = "force-dynamic";

export default async function ArtworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getArtworkPage(await getDb(), await currentUserId(), id);
  if (!d) notFound();
  const { card, mine, prediction, photographed } = d;

  return (
    <section className="grid items-center gap-10 py-4 md:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex justify-center">
        <img src={card.imageUrl ?? ""} alt={`${card.title} by ${card.artistName}`} className="painting max-h-[78vh] w-auto max-w-full object-contain" />
      </div>
      <div className="flex flex-col gap-6">
        <WallLabel art={card} />
        <div className="rounded-2xl border border-line bg-surface p-4">
          {mine ? (
            <div className="flex items-center gap-3">
              <ScoreBadge score={mine.score} tier={mine.tier} size="lg" />
              <div className="text-sm">
                <p className="font-medium">Your score</p>
                <p className="text-ink-2">
                  #{mine.rank} overall · {TIER_LABEL[mine.tier]}
                </p>
              </div>
            </div>
          ) : prediction ? (
            <div className="flex items-center gap-3">
              <ScoreBadge score={prediction.score} predicted lowConfidence={prediction.confidence === "low"} size="lg" />
              <div className="text-sm">
                <p className="font-medium">Predicted for you</p>
                <p className="text-ink-2">
                  {prediction.confidence === "low" ? "Low confidence: you haven't ranked this artist or movement yet." : "Based on the artists and movements you've ranked."}
                </p>
              </div>
            </div>
          ) : null}
          {!mine &&
            (photographed ? (
              <Link href={`/rank?artwork=${card.id}`} className="mt-4 block rounded-full bg-ink px-5 py-2.5 text-center text-sm font-medium text-wall hover:opacity-90">
                Rank it
              </Link>
            ) : (
              <p className="mt-4 text-sm text-ink-2">
                Seen it in person?{" "}
                <Link
                  href={card.museum ? `/visits/new?museum=${card.museum.id}` : "/visits/new"}
                  className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                >
                  Log the visit
                </Link>{" "}
                and add your photo to rank it.
              </p>
            ))}
        </div>
      </div>
    </section>
  );
}
