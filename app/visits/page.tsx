import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getVisits } from "@/lib/server/visits";
import { formatDay } from "@/lib/client/dates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Visits · Docent" };

export default async function VisitsPage() {
  const visits = await getVisits(await getDb(), await currentUserId());

  if (!visits.length) {
    return (
      <section className="mx-auto max-w-lg py-24 text-center">
        <h1 className="font-serif text-4xl sm:text-5xl">Where have you been?</h1>
        <p className="mt-4 text-lg text-ink-2">
          Log a museum visit, add the photos you took of the paintings, and rank them against each other.
          Docent learns your taste from what you actually stood in front of.
        </p>
        <Link href="/visits/new" className="mt-8 inline-block rounded-full bg-ink px-6 py-3 font-medium text-wall hover:opacity-90">
          Log your first visit
        </Link>
      </section>
    );
  }

  const toRank = visits.reduce((n, v) => n + v.toRank, 0);

  return (
    <section className="pb-16 pt-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-serif text-4xl sm:text-5xl">Visits</h1>
          <p className="mt-2 text-ink-2">
            {visits.length} {visits.length === 1 ? "museum visit" : "museum visits"}
            {toRank > 0 && (
              <>
                {" · "}
                <Link href="/rank" className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                  {toRank} {toRank === 1 ? "painting" : "paintings"} waiting to be ranked
                </Link>
              </>
            )}
          </p>
        </div>
        <Link href="/visits/new" className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-wall hover:opacity-90">
          Log a visit
        </Link>
      </header>

      <ol className="mt-10 border-t border-line">
        {visits.map((v) => (
          <li key={v.id} className="border-b border-line">
            <Link href={`/visits/${v.id}`} className="group grid gap-4 py-6 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center sm:gap-8">
              <time dateTime={v.visitedOn} className="text-sm tabular-nums text-ink-2">
                {formatDay(v.visitedOn)}
              </time>
              <div className="min-w-0">
                <h2 className="font-serif text-2xl leading-tight group-hover:underline group-hover:decoration-line group-hover:underline-offset-4 sm:text-3xl">
                  {v.museumName}
                </h2>
                <p className="mt-1 text-sm text-ink-2">
                  {[v.city, v.country].filter(Boolean).join(", ")}
                  {" · "}
                  {v.photoCount} {v.photoCount === 1 ? "photo" : "photos"}
                  {v.toIdentify > 0 && <span className="text-ink"> · {v.toIdentify} to identify</span>}
                  {v.toRank > 0 && <span className="text-ink"> · {v.toRank} to rank</span>}
                </p>
              </div>
              {v.thumbs.length > 0 && (
                <div className="flex items-end gap-2 sm:justify-end">
                  {v.thumbs.map((t) =>
                    t.url ? (
                      <img key={t.id} src={t.url} alt="" loading="lazy" className="painting h-14 w-auto max-w-20 object-cover sm:h-16" />
                    ) : null,
                  )}
                </div>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
