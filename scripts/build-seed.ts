/**
 * Builds fixtures/seed.json from live Wikidata: a small, famous slice
 * (~1,600 pool paintings, ~150 museums) for local dev, tests and the demo.
 * Also records the raw SPARQL responses to fixtures/wikidata/ for parser tests.
 *
 *   pnpm seed:build            (MIN_SITELINKS=10 MUSEUMS=140 to tune)
 */
import fs from "node:fs";
import { createSparqlClient } from "@/lib/ingest/sparql";
import { fetchDataset } from "@/lib/ingest/fetch";
import { normalizeDataset } from "@/lib/ingest/normalize";
import type { Dataset } from "@/lib/ingest/types";

const MIN = Number(process.env.MIN_SITELINKS ?? 10);
const MAX_MUSEUMS = Number(process.env.MUSEUMS ?? 140);
const RECORD = process.env.RECORD === "1" ? "fixtures/wikidata/raw" : undefined;

/** Keep the museums that hold the most pool-artist paintings, plus where pool works hang. */
function trim(ds: Dataset): Dataset {
  const total = new Map<string, number>();
  for (const h of ds.museumArtistHoldings) total.set(h.museumId, (total.get(h.museumId) ?? 0) + h.paintingCount);
  const poolMuseums = new Set(ds.artworks.filter((w) => w.inPool && w.museumId).map((w) => w.museumId!));
  const ranked = ds.museums
    .filter((m) => m.lat != null)
    .sort((a, b) => (total.get(b.id) ?? 0) - (total.get(a.id) ?? 0));
  const keep = new Set<string>([...ranked.slice(0, MAX_MUSEUMS).map((m) => m.id)]);
  // Pool museums are kept only if they hold a meaningful number of works, to stay small.
  for (const id of poolMuseums) if ((total.get(id) ?? 0) >= 5) keep.add(id);
  const artworks = ds.artworks
    .filter((w) => w.inPool || (w.museumId && keep.has(w.museumId)))
    .map((w) => ({ ...w, museumId: w.museumId && keep.has(w.museumId) ? w.museumId : null }));
  // Cap named (non-pool) works per museum to keep the file small.
  const perMuseum = new Map<string, number>();
  const capped = artworks
    .sort((a, b) => b.sitelinks - a.sitelinks)
    .filter((w) => {
      if (w.inPool) return true;
      const n = perMuseum.get(w.museumId!) ?? 0;
      if (n >= 40) return false;
      perMuseum.set(w.museumId!, n + 1);
      return true;
    });
  return normalizeDataset({
    ...ds,
    museums: ds.museums.filter((m) => keep.has(m.id)),
    artworks: capped,
    museumArtistHoldings: ds.museumArtistHoldings.filter((h) => keep.has(h.museumId)),
  });
}

async function main() {
  const sparql = createSparqlClient({ recordDir: RECORD });
  const ds = await fetchDataset(sparql, {
    bands: [{ min: MIN, max: null }],
    namedWorksPerPair: 6,
    log: (m) => console.log(m),
  });
  const out = trim(ds);
  fs.writeFileSync("fixtures/seed.json", JSON.stringify(out));
  const pool = out.artworks.filter((w) => w.inPool).length;
  console.log(
    `seed.json: ${pool} pool paintings, ${out.artworks.length - pool} named works, ` +
      `${out.museums.length} museums, ${out.artists.length} artists, ${out.movements.length} movements`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
