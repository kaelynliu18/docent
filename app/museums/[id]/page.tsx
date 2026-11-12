import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getMuseumDetail } from "@/lib/server/data";
import { ScoreBadge } from "@/components/ScoreBadge";
import { MarkButtons } from "./MarkButtons";
import { DetailMap } from "./DetailMap";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getMuseumDetail(await getDb(), null, id);
  return { title: d ? `${d.museum.name} · Docent` : "Museum · Docent" };
}

export default async function MuseumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getMuseumDetail(await getDb(), await currentUserId(), id);
  if (!d) notFound();
  const { museum } = d;
  const where = [museum.city, museum.country].filter(Boolean).join(", ");

  return (
    <section className="py-4">
      <Link href="/museums" className="text-sm text-ink-2 hover:text-ink">
        ← All matches
      </Link>
      <div className="mt-3 grid gap-8 md:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <h1 className="font-serif text-4xl leading-tight sm:text-5xl">{museum.name}</h1>
          <p className="mt-2 text-ink-2">{where}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href={`/visits/new?museum=${museum.id}`} className="rounded-full bg-ink px-4 py-2 text-sm text-wall hover:opacity-90">
              Log a visit here
            </Link>
            <MarkButtons museumId={museum.id} initial={d.mark} />
            {museum.website && (
              <a href={museum.website} target="_blank" rel="noreferrer" className="rounded-full px-3 py-2 text-sm text-ink-2 underline underline-offset-2 hover:text-ink">
                Museum website ↗
              </a>
            )}
          </div>

          <h2 className="mt-10 font-serif text-2xl">What to see here</h2>
          <p className="text-sm text-ink-2">
            Ranked by how much we think you&apos;ll like each one. Dashed scores are predictions; filled ones are yours.
          </p>
          {d.works.length === 0 ? (
            <p className="mt-4 text-ink-2">We don&apos;t have individual works listed for this museum yet.</p>
          ) : (
            <ol className="mt-4 grid gap-3 sm:grid-cols-2">
              {d.works.slice(0, 24).map((w) => (
                <li key={w.id}>
                  <Link href={`/artwork/${w.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2 hover:border-ink-2">
                    <img src={w.thumbUrl ?? ""} alt={`${w.title} by ${w.artistName}`} loading="lazy" className="size-16 shrink-0 rounded object-cover" />
                    <span className="min-w-0 flex-1">
                      <i className="block truncate font-serif text-lg">{w.title}</i>
                      <span className="block truncate text-sm text-ink-2">{w.artistName}</span>
                    </span>
                    {w.myScore != null ? (
                      <ScoreBadge score={w.myScore} />
                    ) : (
                      <ScoreBadge score={w.predicted} predicted lowConfidence={w.confidence === "low"} />
                    )}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>
        <aside className="flex flex-col gap-6">
          {museum.lat != null && museum.lon != null && (
            <DetailMap pin={{ id: museum.id, name: museum.name, lat: museum.lat, lon: museum.lon }} />
          )}
          {d.holdings.length > 0 && (
            <div>
              <h2 className="mb-2 font-serif text-xl">In the collection</h2>
              <ul className="divide-y divide-line text-sm">
                {d.holdings.map((h) => (
                  <li key={h.artistId} className="flex justify-between py-1.5">
                    <span>{h.name}</span>
                    <span className="tabular-nums text-ink-2">
                      {h.count} painting{h.count === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-2">Counts from Wikidata; real collections may be larger.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
