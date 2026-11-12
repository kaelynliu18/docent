import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getRecommendations, getRegionRecommendations } from "@/lib/server/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recommended · Docent" };

export default async function RecommendationsPage({ searchParams }: { searchParams: Promise<{ region?: string }> }) {
  const { region } = await searchParams;
  const db = await getDb();
  const userId = await currentUserId();
  const cluster = region != null && /^\d+$/.test(region) ? Number(region) : null;
  const { label, recs } = cluster != null ? await getRegionRecommendations(db, userId, cluster) : { label: null, recs: await getRecommendations(db, userId) };
  return (
    <section className="py-4">
      <Link href="/taste/map" className="text-sm text-ink-2 hover:text-ink">
        ← Taste map
      </Link>
      <h1 className="mt-2 font-serif text-4xl">{label ? `Try: ${label}` : "Recommended for you"}</h1>
      <p className="mt-1 text-ink-2">
        {label ? "The paintings from this part of the map that fit your taste best." : "Paintings that look like the ones you ranked highly, mixed so they aren't all the same."}
      </p>
      {recs.length === 0 ? (
        <p className="mt-8 text-ink-2">Nothing to suggest yet. Rank a few paintings first.</p>
      ) : (
        <ul className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-8">
          {recs.map((r) => (
            <li key={r.card.id}>
              <Link href={`/artwork/${r.card.id}`} className="group block">
                <img src={r.card.thumbUrl ?? ""} alt={`${r.card.title} by ${r.card.artistName}`} loading="lazy" className="aspect-[4/5] w-full rounded object-cover shadow-[var(--shadow)]" />
                <p className="mt-3 font-serif italic leading-snug group-hover:underline">{r.card.title}</p>
                <p className="text-xs text-ink-2">{r.card.artistName}</p>
                <p className="mt-1 text-xs text-ink-2">{r.reason}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
