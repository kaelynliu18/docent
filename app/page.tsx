import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { getHeroPaintings } from "@/lib/server/data";
import { HeroRotator } from "./HeroRotator";

export const dynamic = "force-dynamic";

export default async function Home() {
  const hero = await getHeroPaintings(await getDb(), 8);
  return (
    <section className="grid min-h-[78vh] items-center gap-10 py-6 md:grid-cols-[1fr_minmax(0,1.1fr)]">
      <div className="order-2 md:order-1">
        <h1 className="font-serif text-5xl leading-[1.05] tracking-tight sm:text-6xl">
          Rank what you saw. Find where to go next.
        </h1>
        <p className="mt-5 max-w-md text-lg text-ink-2">
          After a museum visit, add the photos you took and put the paintings head to head. Docent learns your
          taste from what you actually stood in front of, then points you to the museums you&apos;ll love next,
          and says exactly why.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/visits/new" className="rounded-full bg-ink px-6 py-3 font-medium text-wall hover:opacity-90">
            Log a visit
          </Link>
          <Link href="/account" className="rounded-full px-4 py-3 text-ink-2 hover:text-ink">
            Try the demo account
          </Link>
        </div>
        <p className="mt-6 text-sm text-ink-2">No account needed. Your photos stay private to you.</p>
      </div>
      <div className="order-1 md:order-2">
        <HeroRotator paintings={hero.map((h) => ({ id: h.id, title: h.title, artist: h.artistName, src: h.imageUrl }))} />
      </div>
    </section>
  );
}
