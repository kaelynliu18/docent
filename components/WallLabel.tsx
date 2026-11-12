import Link from "next/link";
import type { ArtworkCard } from "@/lib/server/data";
import { commonsPage } from "@/lib/images";

/** Museum-style label: artist, title, date, movement, where it hangs. */
export function WallLabel({ art, linkMuseum = true }: { art: ArtworkCard; linkMuseum?: boolean }) {
  const movement = art.movements[0]?.name;
  const genre = art.genres?.[0]?.name;
  const where = art.museum ? [art.museum.name, art.museum.city].filter(Boolean).join(", ") : null;
  return (
    <div className="max-w-xs border-l-2 border-line pl-4 text-sm leading-snug md:leading-relaxed">
      <p className="font-medium text-ink">{art.artistName}</p>
      <p className="font-serif text-xl leading-snug text-ink">
        <i>{art.title}</i>
        {art.year != null && <span className="not-italic text-ink-2">, {art.year < 0 ? `${-art.year} BCE` : art.year}</span>}
      </p>
      {(movement || genre) && (
        <p className="mt-2 text-ink-2 max-md:[@media(max-height:740px)]:hidden">{[movement, genre].filter(Boolean).map((x) => capitalize(x!)).join(" · ")}</p>
      )}
      {where && (
        <p className="text-ink-2 max-md:[@media(max-height:740px)]:hidden">
          {linkMuseum && art.museum ? (
            <Link className="underline decoration-line underline-offset-2 hover:text-ink" href={`/museums/${art.museum.id}`}>
              {where}
            </Link>
          ) : (
            where
          )}
        </p>
      )}
      {art.imageFile && art.imageUrl?.startsWith("https://commons.") && (
        <p className="mt-2 text-xs text-ink-2 max-md:[@media(max-height:740px)]:hidden">
          <a className="underline decoration-line underline-offset-2 hover:text-ink" href={commonsPage(art.imageFile)!} target="_blank" rel="noreferrer">
            Image: Wikimedia Commons
          </a>
        </p>
      )}
    </div>
  );
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
