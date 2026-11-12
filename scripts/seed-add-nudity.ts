/**
 * One-off: add `nudity` flags to fixtures/seed.json without rebuilding it
 * (a full `pnpm seed:build` takes 20+ minutes). Same rule as ingestion:
 * depicts nudity (P180) OR genre nude/erotic art.
 */
import fs from "node:fs";
import { batched, createSparqlClient } from "@/lib/ingest/sparql";
import { NUDITY_GENRE_RE, nudityQuery } from "@/lib/ingest/queries";
import { parseNudity } from "@/lib/ingest/parse";
import type { Dataset } from "@/lib/ingest/types";

async function main() {
  const path = "fixtures/seed.json";
  const ds = JSON.parse(fs.readFileSync(path, "utf8")) as Dataset;
  const sparql = createSparqlClient();
  const ids = ds.artworks.map((w) => w.id);
  const depicts = parseNudity(await batched(ids, 300, (b) => sparql("nudity", nudityQuery(b))));
  const nudeGenres = new Set(ds.genres.filter((g) => NUDITY_GENRE_RE.test(g.name)).map((g) => g.id));
  const byGenre = new Set(ds.artworkGenres.filter((ag) => nudeGenres.has(ag.genreId)).map((ag) => ag.artworkId));
  let n = 0;
  for (const w of ds.artworks) {
    w.nudity = depicts.has(w.id) || byGenre.has(w.id);
    if (w.nudity) n++;
  }
  fs.writeFileSync(path, JSON.stringify(ds));
  const pool = ds.artworks.filter((w) => w.inPool);
  console.log(`nudity: ${n}/${ds.artworks.length} artworks (${pool.filter((w) => w.nudity).length}/${pool.length} in pool); depicts ${depicts.size}, genre ${byGenre.size}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
