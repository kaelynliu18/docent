import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getRankedList, type RankedItem } from "@/lib/server/data";
import { TIERS } from "@/lib/algo/types";
import { ScoreBadge } from "@/components/ScoreBadge";
import { RowMenu } from "./RowMenu";

export const dynamic = "force-dynamic";
export const metadata = { title: "My list · Docent" };

const byline = (r: RankedItem) => [r.artistName, r.year].filter((x) => x != null).join(", ");
const context = (r: RankedItem) => r.movements[0]?.name ?? r.genres[0]?.name ?? null;

export default async function ListPage() {
  const list = await getRankedList(await getDb(), await currentUserId());
  // One list, best first: tiers stack loved → fine → meh, so scores stay in descending order.
  const rows = TIERS.flatMap((t) => list[t]);
  const total = rows.length;

  if (!total) {
    return (
      <section className="mx-auto max-w-md py-24 text-center">
        <h1 className="font-serif text-4xl">Your wall is empty</h1>
        <p className="mt-3 text-ink-2">
          Log a museum visit, add your photos, and rank what you saw. Each painting hangs here with its score.
        </p>
        <Link href="/visits/new" className="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-wall">
          Log a visit
        </Link>
      </section>
    );
  }

  const hung = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <section className="pb-16 pt-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="font-serif text-4xl sm:text-5xl">My list</h1>
          <p className="mt-2 text-ink-2">
            {total} {total === 1 ? "painting" : "paintings"}, best first. Scores settle as you rank more.
          </p>
        </div>
        <Link
          href="/visits/new"
          className="rounded-full border border-line bg-surface px-4 py-2 text-sm transition-colors hover:border-ink-2"
        >
          Log a visit
        </Link>
      </header>

      {/* The top of the list, hung on the wall along a shared bottom line. */}
      <ol className="mt-10 grid grid-cols-2 items-start gap-x-5 gap-y-10 sm:gap-x-8 md:grid-cols-3 md:gap-x-10">
        {hung.map((r, i) => (
          <li key={r.id} className={`fade-in ${i === 0 ? "col-span-2 md:col-span-1" : ""}`}>
            <Link href={`/artwork/${r.id}`} className="group block">
              <div className={`flex items-end justify-center ${i === 0 ? "h-72 sm:h-80 md:h-72" : "h-44 sm:h-60 md:h-72"}`}>
                <img
                  src={r.imageUrl ?? r.thumbUrl ?? ""}
                  alt={`${r.title} by ${r.artistName}`}
                  className="painting max-h-full max-w-full object-contain transition-transform duration-500 ease-out group-hover:-translate-y-1"
                />
              </div>
            </Link>
            <div className="mt-5 flex items-start gap-3">
              <span
                aria-label={`Rank ${i + 1}`}
                className="font-serif text-4xl leading-none text-loved tabular-nums sm:text-5xl"
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <Link href={`/artwork/${r.id}`} className="block decoration-line underline-offset-4 hover:underline">
                  <i className="block font-serif text-lg leading-snug text-balance">{r.title}</i>
                </Link>
                <span className="mt-0.5 block text-sm text-ink-2">{byline(r)}</span>
                <div className="mt-3 flex items-center gap-1">
                  <ScoreBadge score={r.score} tier={r.tier} />
                  <RowMenu artworkId={r.id} title={r.title} />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {rest.length > 0 && (
        <ol start={4} className="mt-16 border-t border-line">
          {rest.map((r, i) => (
            <li key={r.id} className="group flex items-center gap-2.5 border-b border-line py-3 sm:gap-5">
              <span className="w-6 shrink-0 text-right font-serif text-xl tabular-nums text-ink-2 sm:w-10 sm:text-2xl">
                {i + 4}
              </span>
              <Link href={`/artwork/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
                <span className="flex size-12 shrink-0 items-center justify-center sm:size-16">
                  <img
                    src={r.thumbUrl ?? ""}
                    alt={`${r.title} by ${r.artistName}`}
                    loading="lazy"
                    className="painting max-h-full max-w-full object-contain transition-transform duration-300 ease-out group-hover:scale-105"
                  />
                </span>
                <span className="min-w-0">
                  <i className="line-clamp-2 font-serif text-base leading-snug sm:truncate sm:text-lg">{r.title}</i>
                  <span className="block truncate text-sm text-ink-2">
                    {byline(r)}
                    {context(r) && <span className="hidden sm:inline"> · {context(r)}</span>}
                  </span>
                </span>
              </Link>
              <ScoreBadge score={r.score} tier={r.tier} />
              <RowMenu artworkId={r.id} title={r.title} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
