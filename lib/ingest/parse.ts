import type { Binding } from "./sparql";
import type { ArtistRow, ArtworkRow, MuseumRow } from "./types";

/** Pure parsers from SPARQL bindings to rows. Tested against saved fixtures. */

export function qid(uri: string | undefined): string | null {
  if (!uri) return null;
  const m = /\/(Q\d+)$/.exec(uri);
  return m ? m[1] : null;
}

/** Items whose only "label" is their Q-number have no usable name. */
export function isUsableLabel(label: string | undefined): label is string {
  return !!label && !/^Q\d+$/.test(label.trim());
}

export function parseYear(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(-?\d{1,4})-/.exec(v.replace(/^\+/, ""));
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
}

/** "http://commons.wikimedia.org/wiki/Special:FilePath/A%20B.jpg" → "A B.jpg" */
export function commonsFileName(uri: string | undefined): string | null {
  if (!uri) return null;
  const i = uri.indexOf("Special:FilePath/");
  if (i === -1) return null;
  try {
    return decodeURIComponent(uri.slice(i + "Special:FilePath/".length));
  } catch {
    return null;
  }
}

/** "https://en.wikipedia.org/wiki/Mona_Lisa" → "Mona_Lisa" */
export function wikiTitle(url: string | undefined): string | null {
  if (!url) return null;
  const m = /\/wiki\/(.+)$/.exec(url);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** "Point(2.33 48.86)" → { lat: 48.86, lon: 2.33 } */
export function parsePoint(v: string | undefined): { lat: number; lon: number } | null {
  if (!v) return null;
  const m = /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/.exec(v);
  if (!m) return null;
  return { lon: Number(m[1]), lat: Number(m[2]) };
}

const num = (v: string | undefined) => (v == null ? 0 : Number(v) || 0);

/** Pool rows: one artwork per painting (first artist/image wins), unlabeled ones dropped. */
export function parsePool(bindings: Binding[]): Omit<ArtworkRow, "museumId">[] {
  const out = new Map<string, Omit<ArtworkRow, "museumId">>();
  for (const b of bindings) {
    const id = qid(b.p?.value);
    const artistId = qid(b.artist?.value);
    const title = b.pLabel?.value;
    if (!id || !artistId || !isUsableLabel(title) || out.has(id)) continue;
    out.set(id, {
      id,
      title,
      artistId,
      year: parseYear(b.inception?.value),
      imageFile: commonsFileName(b.image?.value),
      sitelinks: num(b.sl?.value),
      inPool: true,
    });
  }
  return [...out.values()];
}

export type ArtworkDetails = {
  movements: Map<string, { id: string; name: string }[]>;
  genres: Map<string, { id: string; name: string }[]>;
  /** English Wikipedia article title, for pageviews. */
  enwiki: Map<string, string>;
  /** Chosen current museum per painting. */
  museum: Map<string, string>;
};

/**
 * Prefer a collection with coordinates and no end-time qualifier
 * (former owners and ended loans have one).
 */
export function parseArtworkDetails(bindings: Binding[]): ArtworkDetails {
  const movements = new Map<string, { id: string; name: string }[]>();
  const genres = new Map<string, { id: string; name: string }[]>();
  const enwiki = new Map<string, string>();
  const candidates = new Map<string, { coll: string; score: number }[]>();
  for (const b of bindings) {
    const p = qid(b.p?.value);
    if (!p) continue;
    const genre = qid(b.genre?.value);
    if (genre && isUsableLabel(b.genreLabel?.value)) {
      const list = genres.get(p) ?? [];
      if (!list.some((g) => g.id === genre)) list.push({ id: genre, name: b.genreLabel!.value });
      genres.set(p, list);
    }
    const title = wikiTitle(b.article?.value);
    if (title) enwiki.set(p, title);
    const move = qid(b.move?.value);
    if (move && isUsableLabel(b.moveLabel?.value)) {
      const list = movements.get(p) ?? [];
      if (!list.some((m) => m.id === move)) list.push({ id: move, name: b.moveLabel!.value });
      movements.set(p, list);
    }
    const coll = qid(b.coll?.value);
    if (coll) {
      const score = (b.coord ? 2 : 0) + (b.end ? 0 : 1);
      const list = candidates.get(p) ?? [];
      list.push({ coll, score });
      candidates.set(p, list);
    }
  }
  const museum = new Map<string, string>();
  for (const [p, list] of candidates) {
    const best = list.find((c) => c.score === 3);
    if (best) museum.set(p, best.coll);
  }
  return { movements, genres, enwiki, museum };
}

export function parseArtists(bindings: Binding[]): {
  artists: ArtistRow[];
  movements: Map<string, { id: string; name: string }[]>;
} {
  const artists = new Map<string, ArtistRow>();
  const movements = new Map<string, { id: string; name: string }[]>();
  for (const b of bindings) {
    const id = qid(b.a?.value);
    if (!id) continue;
    if (!artists.has(id)) {
      artists.set(id, {
        id,
        name: isUsableLabel(b.aLabel?.value) ? b.aLabel!.value : id,
        birthYear: parseYear(b.birth?.value),
        deathYear: parseYear(b.death?.value),
        sitelinks: num(b.sl?.value),
      });
    }
    const move = qid(b.move?.value);
    if (move && isUsableLabel(b.moveLabel?.value)) {
      const list = movements.get(id) ?? [];
      if (!list.some((m) => m.id === move)) list.push({ id: move, name: b.moveLabel!.value });
      movements.set(id, list);
    }
  }
  return { artists: [...artists.values()], movements };
}

export function parseHoldings(bindings: Binding[]) {
  const out: { museumId: string; artistId: string; paintingCount: number }[] = [];
  for (const b of bindings) {
    const museumId = qid(b.coll?.value);
    const artistId = qid(b.artist?.value);
    const n = num(b.n?.value);
    if (museumId && artistId && n > 0) out.push({ museumId, artistId, paintingCount: n });
  }
  return out;
}

/** Up to `perPair` works per (artist, museum), most famous first. */
export function parseNamedWorks(bindings: Binding[], perPair = 20): ArtworkRow[] {
  const byId = new Map<string, ArtworkRow>();
  for (const b of bindings) {
    const id = qid(b.p?.value);
    const artistId = qid(b.artist?.value);
    const museumId = qid(b.coll?.value);
    if (!id || !artistId || !museumId || !isUsableLabel(b.pLabel?.value) || byId.has(id)) continue;
    byId.set(id, {
      id,
      title: b.pLabel!.value,
      artistId,
      museumId,
      year: parseYear(b.inception?.value),
      imageFile: commonsFileName(b.image?.value),
      sitelinks: num(b.sl?.value),
      inPool: false,
    });
  }
  const groups = new Map<string, ArtworkRow[]>();
  for (const w of byId.values()) {
    const k = `${w.artistId}|${w.museumId}`;
    const g = groups.get(k) ?? [];
    g.push(w);
    groups.set(k, g);
  }
  return [...groups.values()].flatMap((g) =>
    g.sort((a, b) => b.sitelinks - a.sitelinks).slice(0, perPair),
  );
}

export function parseMuseums(bindings: Binding[]): MuseumRow[] {
  const out = new Map<string, MuseumRow>();
  for (const b of bindings) {
    const id = qid(b.m?.value);
    if (!id || out.has(id) || !isUsableLabel(b.mLabel?.value)) continue;
    const pt = parsePoint(b.coord?.value);
    out.set(id, {
      id,
      name: b.mLabel!.value,
      city: b.cityLabel?.value ?? null,
      country: b.countryLabel?.value ?? null,
      lat: pt?.lat ?? null,
      lon: pt?.lon ?? null,
      website: b.website?.value ?? null,
      sitelinks: num(b.sl?.value),
    });
  }
  return [...out.values()];
}

/** "Part of" (P361) links, e.g. Department of Paintings of the Louvre → Louvre. */
export function parseMuseumParents(bindings: Binding[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const b of bindings) {
    const id = qid(b.m?.value);
    const parent = qid(b.parent?.value);
    if (!id || !parent || id === parent) continue;
    const l = out.get(id) ?? [];
    if (!l.includes(parent)) l.push(parent);
    out.set(id, l);
  }
  return out;
}
