import { HideNudityOffer } from "./HideNudityOffer";
import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getTasteProfile } from "@/lib/server/data";
import { capitalize } from "@/components/WallLabel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Taste · Docent" };

type Row = Awaited<ReturnType<typeof getTasteProfile>>["artists"][number];

export default async function TastePage() {
  const taste = await getTasteProfile(await getDb(), await currentUserId());

  if (taste.rankedCount < 3) {
    const left = 3 - taste.rankedCount;
    return (
      <section className="mx-auto max-w-md py-24 text-center">
        <h1 className="font-serif text-4xl">Your taste, in progress</h1>
        <p className="mt-3 text-ink-2">
          Rank {left} more painting{left === 1 ? "" : "s"} and your favourite artists and movements will show up here.
        </p>
        <Link href="/rank" className="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-wall">
          Keep ranking
        </Link>
      </section>
    );
  }

  return (
    <section className="py-4">
      <h1 className="font-serif text-4xl">Your taste</h1>
      <p className="mt-1 text-ink-2">From {taste.rankedCount} ranked paintings. Tap a row to see the paintings behind it.</p>
      <div className="mt-8 grid gap-10 md:grid-cols-2">
        <Group title="Artists" rows={taste.artists} empty="No clear favourite artist yet. Rank a few more of the ones you love." />
        <Group title="Movements" rows={taste.movements} empty="No clear favourite movement yet." />
        <Group title="Subjects" rows={taste.genres} empty="No clear favourite subject yet." />
        <Group title="Eras" rows={taste.periods} empty="No clear favourite era yet." />
      </div>
      {taste.dislikes.length > 0 && (
        <div className="mt-12">
          <h2 className="font-serif text-2xl">Not your thing</h2>
          <p className="text-sm text-ink-2">We&apos;ll show you fewer of these and predict them lower.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {taste.dislikes.map((d) => (
              <li key={d.kind + d.id} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
                {capitalize(d.name)} <span className="text-ink-2">· {d.kind === "genre" ? "subject" : d.kind}</span>
              </li>
            ))}
          </ul>
          {taste.dislikes.some((d) => d.kind === "content" && d.id === "nudity") && !taste.prefs.hideNudity && <HideNudityOffer />}
        </div>
      )}
    </section>
  );
}

function Group({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  const max = Math.max(...rows.map((r) => r.affinity), 0.0001);
  return (
    <div>
      <h2 className="mb-3 font-serif text-2xl">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-ink-2">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <details className="group rounded-xl border border-line bg-surface px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center gap-4">
                  <span className="w-40 shrink-0 truncate font-medium sm:w-48">{capitalize(r.name)}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                    <span className="block h-full rounded-full bg-loved" style={{ width: `${Math.max(6, (r.affinity / max) * 100)}%` }} />
                  </span>
                  <span className="sr-only">Strength {Math.round((r.affinity / max) * 100)} percent</span>
                  <span className="w-16 text-right text-xs text-ink-2">{r.count} ranked</span>
                </summary>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {r.works.map((w) => (
                    <li key={w.id}>
                      <Link href={`/artwork/${w.id}`} title={`${w.title} · ${w.score.toFixed(1)}`}>
                        <img src={w.thumbUrl ?? ""} alt={w.title} loading="lazy" className="size-16 rounded object-cover" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
