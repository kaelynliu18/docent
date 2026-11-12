import { batched, type SparqlClient } from "./sparql";
import {
  artistsQuery,
  artworkDetailsQuery,
  holdingsQuery,
  museumsQuery,
  namedWorksQuery,
  NUDITY_GENRE_RE,
  nudityQuery,
  poolBandQuery,
} from "./queries";
import {
  parseNudity,
  parseArtists,
  parseArtworkDetails,
  parseHoldings,
  parseMuseumParents,
  parseMuseums,
  parseNamedWorks,
  parsePool,
} from "./parse";
import { normalizeDataset } from "./normalize";
import { computeFame, fetchPageviews } from "./fame";
import type { ArtworkRow, Dataset, MovementRow } from "./types";

export type Band = { min: number; max: number | null };
/** ≥8 Wikipedia languages ≈ 2,400 paintings (Nov 2026); tune with POOL_MIN_SITELINKS. */
export const DEFAULT_BANDS: Band[] = [{ min: Number(process.env.POOL_MIN_SITELINKS ?? 8), max: null }];

export type PassLog = { pass: string; rows: number; ms: number };

export type FetchOptions = {
  bands?: Band[];
  holdingsBatch?: number;
  namedWorksBatch?: number;
  namedWorksPerPair?: number;
  /** Fetch Wikipedia pageviews to compute fame (default true). */
  fame?: boolean;
  log?: (msg: string) => void;
  onPass?: (p: PassLog) => void | Promise<void>;
};

/**
 * The three passes from spec §3. Returns a normalized in-memory dataset;
 * nothing touches the database here, so a failure never corrupts data.
 */
export async function fetchDataset(sparql: SparqlClient, opts: FetchOptions = {}): Promise<Dataset> {
  const log = opts.log ?? (() => {});
  const timed = async <T>(pass: string, f: () => Promise<T>, rows: (t: T) => number) => {
    const t0 = Date.now();
    const out = await f();
    const p = { pass, rows: rows(out), ms: Date.now() - t0 };
    log(`${pass}: ${p.rows} rows in ${(p.ms / 1000).toFixed(1)}s`);
    await opts.onPass?.(p);
    return out;
  };

  /* Pass 1: pool */
  const pool = await timed(
    "pool",
    async () => {
      const seen = new Map<string, Omit<ArtworkRow, "museumId">>();
      for (const b of opts.bands ?? DEFAULT_BANDS) {
        const rows = parsePool(
          await sparql(`pool-${b.min}-${b.max ?? "up"}`, poolBandQuery(b.min, b.max), { preferFallback: true }),
        );
        for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
      }
      return [...seen.values()];
    },
    (x) => x.length,
  );

  const artistIds = [...new Set(pool.map((p) => p.artistId))];
  const artistInfo = await timed(
    "artists",
    async () => parseArtists(await batched(artistIds, 150, (ids) => sparql("artists", artistsQuery(ids)))),
    (a) => a.artists.length,
  );

  /* Pass 2: holdings (+ named works per artist per museum) */
  const holdings = await timed(
    "holdings",
    async () =>
      parseHoldings(
        await batched(artistIds, opts.holdingsBatch ?? 50, (ids) => sparql("holdings", holdingsQuery(ids))),
      ),
    (h) => h.length,
  );

  const named = await timed(
    "named-works",
    async () =>
      parseNamedWorks(
        await batched(artistIds, opts.namedWorksBatch ?? 25, (ids) =>
          sparql("named-works", namedWorksQuery(ids)),
        ),
        opts.namedWorksPerPair ?? 20,
      ),
    (w) => w.length,
  );

  /* Movements, genres, collection and enwiki article for every artwork we keep. */
  const allIds = [...new Set([...pool.map((p) => p.id), ...named.map((w) => w.id)])];
  const details = await timed(
    "artwork-details",
    async () =>
      parseArtworkDetails(
        await batched(allIds, 200, (ids) => sparql("artwork-details", artworkDetailsQuery(ids))),
      ),
    (d) => d.genres.size,
  );
  /* Nudity: what the painting depicts (P180), plus nude/erotic genres below. */
  const depictsNudity = await timed(
    "nudity",
    async () => parseNudity(await batched(allIds, 300, (ids) => sparql("nudity", nudityQuery(ids)))),
    (s) => s.size,
  );

  const poolIds = new Set(pool.map((p) => p.id));
  const poolMuseum = new Map([...details.museum].filter(([id]) => poolIds.has(id)));

  /* Fame: pageviews + sitelinks, for ordering the queue. */
  const fame = await timed(
    "fame",
    async () => {
      const titles = new Map([...details.enwiki].filter(([id]) => poolIds.has(id)));
      const views = opts.fame === false ? new Map<string, number>() : await fetchPageviews(titles, { log });
      return computeFame(pool, views);
    },
    (f) => f.size,
  );

  /* Pass 3: museums */
  const museumIds = [
    ...new Set([
      ...holdings.map((h) => h.museumId),
      ...poolMuseum.values(),
      ...named.map((w) => w.museumId!),
    ]),
  ];
  const { museums, parents } = await timed(
    "museums",
    async () => {
      const b = await batched(museumIds, 200, (ids) => sparql("museums", museumsQuery(ids)));
      const museums = parseMuseums(b);
      const parents = parseMuseumParents(b);
      // Fetch parent museums we haven't seen (e.g. the Louvre itself).
      const known = new Set(museums.map((m) => m.id));
      const missing = [...new Set([...parents.values()].flat())].filter((id) => !known.has(id));
      if (missing.length) {
        const pb = await batched(missing, 200, (ids) => sparql("museum-parents", museumsQuery(ids)));
        museums.push(...parseMuseums(pb));
      }
      return { museums, parents };
    },
    (m) => m.museums.length,
  );

  /* Assemble */
  const movements = new Map<string, MovementRow>();
  const artistMovements: Dataset["artistMovements"] = [];
  for (const [artistId, ms] of artistInfo.movements) {
    for (const m of ms) {
      movements.set(m.id, m);
      artistMovements.push({ artistId, movementId: m.id });
    }
  }
  for (const ms of details.movements.values()) for (const m of ms) movements.set(m.id, m);
  const genres = new Map<string, { id: string; name: string }>();
  const artworkGenres: Dataset["artworkGenres"] = [];
  for (const [artworkId, gs] of details.genres) {
    for (const g of gs) {
      genres.set(g.id, g);
      artworkGenres.push({ artworkId, genreId: g.id });
    }
  }

  const nudeGenre = new Set(
    [...details.genres].filter(([, gs]) => gs.some((g) => NUDITY_GENRE_RE.test(g.name))).map(([id]) => id),
  );
  const isNude = (id: string) => depictsNudity.has(id) || nudeGenre.has(id);

  const artworks = new Map<string, ArtworkRow>();
  for (const w of named) artworks.set(w.id, { ...w, nudity: isNude(w.id) });
  for (const p of pool) {
    artworks.set(p.id, {
      ...p,
      fame: fame.get(p.id) ?? 0,
      nudity: isNude(p.id),
      museumId: poolMuseum.get(p.id) ?? artworks.get(p.id)?.museumId ?? null,
    });
  }

  // Movement on the painting, else inherited from the artist (half weight in taste).
  const artworkMovements: Dataset["artworkMovements"] = [];
  for (const w of artworks.values()) {
    const own = details.movements.get(w.id);
    if (own?.length) {
      for (const m of own) artworkMovements.push({ artworkId: w.id, movementId: m.id, source: "artwork" });
    } else {
      for (const m of artistInfo.movements.get(w.artistId) ?? []) {
        artworkMovements.push({ artworkId: w.id, movementId: m.id, source: "artist" });
      }
    }
  }

  return normalizeDataset({
    artists: artistInfo.artists,
    movements: [...movements.values()],
    artistMovements,
    museums,
    artworks: [...artworks.values()],
    artworkMovements,
    genres: [...genres.values()],
    artworkGenres,
    museumArtistHoldings: holdings,
    museumMovementHoldings: [],
  }, parents);
}
