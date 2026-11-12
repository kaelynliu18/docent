import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getTasteMap } from "@/lib/server/data";
import { MapClient } from "./MapClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Taste map · Docent" };

export default async function TasteMapPage() {
  const data = await getTasteMap(await getDb(), await currentUserId());
  return (
    <section className="py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl">Your taste map</h1>
          <p className="mt-1 max-w-2xl text-ink-2">
            Every painting in Docent, placed so ones that look alike sit together. Your rankings light up; the labels name each
            neighbourhood.
          </p>
        </div>
        <Link href="/recommendations" className="rounded-full border border-line bg-surface px-4 py-2 text-sm hover:border-ink-2">
          Recommended for you
        </Link>
      </div>
      <div className="mt-6">
        {data.ready ? (
          <MapClient data={data} />
        ) : (
          <p className="rounded-xl border border-line bg-surface px-4 py-6 text-ink-2">
            The map hasn&apos;t been built yet. Run <code>pnpm embed</code> then <code>pnpm taste-map</code>.
          </p>
        )}
      </div>
    </section>
  );
}
