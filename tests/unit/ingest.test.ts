import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  commonsFileName,
  isUsableLabel,
  parseArtists,
  parseArtworkDetails,
  parseHoldings,
  parseMuseums,
  parseNamedWorks,
  parsePoint,
  parsePool,
  parseYear,
  qid,
  wikiTitle,
} from "@/lib/ingest/parse";
import { computeFame } from "@/lib/ingest/fame";
import { findDepartmentParents, findDuplicateMuseums, normalizeDataset } from "@/lib/ingest/normalize";
import type { Binding } from "@/lib/ingest/sparql";
import type { Dataset, MuseumRow } from "@/lib/ingest/types";

const fx = (name: string): Binding[] =>
  JSON.parse(fs.readFileSync(`fixtures/wikidata/${name}.json`, "utf8")).results.bindings;

describe("value parsers", () => {
  it("parses ids, years, files, points", () => {
    expect(qid("http://www.wikidata.org/entity/Q12418")).toBe("Q12418");
    expect(qid("nope")).toBeNull();
    expect(parseYear("1503-01-01T00:00:00Z")).toBe(1503);
    expect(parseYear("-0500-01-01T00:00:00Z")).toBe(-500);
    expect(parseYear("http://www.wikidata.org/.well-known/genid/abc")).toBeNull();
    expect(commonsFileName("http://commons.wikimedia.org/wiki/Special:FilePath/A%20B%C3%A9.jpg")).toBe("A Bé.jpg");
    expect(parsePoint("Point(2.3376 48.8606)")).toEqual({ lat: 48.8606, lon: 2.3376 });
    expect(isUsableLabel("Q123")).toBe(false);
    expect(isUsableLabel("Mona Lisa")).toBe(true);
    expect(wikiTitle("https://en.wikipedia.org/wiki/The_Night_Caf%C3%A9")).toBe("The_Night_Café");
  });

  it("fame blends pageview and sitelink percentiles", () => {
    const items = [
      { id: "obscure", sitelinks: 8 },
      { id: "viral", sitelinks: 9 },
      { id: "classic", sitelinks: 60 },
    ];
    const views = new Map([["obscure", 1_000], ["viral", 900_000], ["classic", 300_000]]);
    const f = computeFame(items, views);
    expect(f.get("obscure")).toBe(0);
    // The heavily-viewed painting outranks the many-languages one at the default 60/40 blend.
    expect(f.get("viral")!).toBeGreaterThan(f.get("classic")!);
    expect(f.get("classic")!).toBeGreaterThan(f.get("obscure")!);
    // With no pageviews at all, sitelinks alone decide.
    const g = computeFame(items, new Map());
    expect(g.get("classic")!).toBeGreaterThan(g.get("viral")!);
  });
});

describe("parsers on saved Wikidata responses", () => {
  it("pool: one row per painting, all labelled, with artist and image", () => {
    const rows = parsePool(fx("pool"));
    expect(rows.length).toBeGreaterThan(10);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.id).toMatch(/^Q\d+$/);
      expect(r.artistId).toMatch(/^Q\d+$/);
      expect(isUsableLabel(r.title)).toBe(true);
      expect(r.imageFile).toBeTruthy();
      expect(r.inPool).toBe(true);
    }
  });

  it("pool drops Q-number labels", () => {
    const rows = parsePool([
      { p: { type: "uri", value: "http://www.wikidata.org/entity/Q1" }, pLabel: { type: "literal", value: "Q1" }, artist: { type: "uri", value: "http://www.wikidata.org/entity/Q2" } },
    ]);
    expect(rows).toEqual([]);
  });

  it("artwork details pick a current collection with coordinates", () => {
    const d = parseArtworkDetails(fx("artwork-details"));
    const g = parseArtworkDetails([
      { p: { type: "uri", value: "e/Q1" }, genre: { type: "uri", value: "e/Q191163" }, genreLabel: { type: "literal", value: "landscape painting" } },
      { p: { type: "uri", value: "e/Q1" }, article: { type: "uri", value: "https://en.wikipedia.org/wiki/Some_Painting" } },
    ]);
    expect(g.genres.get("Q1")).toEqual([{ id: "Q191163", name: "landscape painting" }]);
    expect(g.enwiki.get("Q1")).toBe("Some_Painting");
    expect(d.museum.size + d.movements.size).toBeGreaterThan(0);
    const synthetic = parseArtworkDetails([
      { p: { type: "uri", value: "e/Q1" }, coll: { type: "uri", value: "e/Q10" }, end: { type: "literal", value: "1900" }, coord: { type: "literal", value: "Point(0 0)" } },
      { p: { type: "uri", value: "e/Q1" }, coll: { type: "uri", value: "e/Q11" } },
      { p: { type: "uri", value: "e/Q1" }, coll: { type: "uri", value: "e/Q12" }, coord: { type: "literal", value: "Point(1 1)" } },
    ]);
    expect(synthetic.museum.get("Q1")).toBe("Q12");
  });

  it("artists, holdings, named works, museums", () => {
    const a = parseArtists(fx("artists"));
    expect(a.artists.length).toBeGreaterThan(0);
    const h = parseHoldings(fx("holdings"));
    expect(h.every((x) => x.paintingCount > 0)).toBe(true);
    const w = parseNamedWorks(fx("named-works"), 2);
    const perPair = new Map<string, number>();
    for (const x of w) perPair.set(`${x.artistId}|${x.museumId}`, (perPair.get(`${x.artistId}|${x.museumId}`) ?? 0) + 1);
    expect(Math.max(...perPair.values())).toBeLessThanOrEqual(2);
    const m = parseMuseums(fx("museums"));
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((x) => x.lat != null && x.lon != null)).toBe(true);
  });
});

const mus = (id: string, name: string, lat: number, lon: number, sitelinks = 1): MuseumRow => ({
  id, name, lat, lon, sitelinks, city: null, country: null, website: null,
});

describe("normalization", () => {
  it("merges a museum and its foundation at the same spot, keeps neighbours apart", () => {
    const remap = findDuplicateMuseums([
      mus("Q1", "Musée Marmottan Monet", 48.8594, 2.2675, 40),
      mus("Q2", "Fondation Marmottan", 48.8595, 2.2676, 3),
      mus("Q3", "Alte Nationalgalerie", 52.5208, 13.3985, 30),
      mus("Q4", "Bode-Museum", 52.5219, 13.3947, 30),
    ]);
    expect(remap.get("Q2")).toBe("Q1");
    expect(remap.has("Q4")).toBe(false);
  });

  it("rolls small departments up into their parent museum", () => {
    const louvre = mus("Q19675", "Louvre Museum", 48.861111, 2.335833, 170);
    const paintings = mus("Q3044768", "Department of Paintings of the Louvre", 48.861111, 2.335833, 1);
    const prints = mus("Q3044753", "Department of Prints and Drawings of the Louvre", 48.861111, 2.335833, 2);
    const alte = mus("Q162111", "Alte Nationalgalerie", 52.5208, 13.3985, 40);
    const smb = mus("Q700222", "Berlin State Museums", 52.5208, 13.3986, 30);
    const parents = new Map([
      ["Q3044768", ["Q19675"]],
      ["Q3044753", ["Q19675"]],
      ["Q162111", ["Q700222"]],
    ]);
    const remap = findDepartmentParents([louvre, paintings, prints, alte, smb], parents);
    expect(remap.get("Q3044768")).toBe("Q19675");
    expect(remap.get("Q3044753")).toBe("Q19675");
    expect(remap.has("Q162111")).toBe(false); // a real museum keeps its identity

    const ds: Dataset = {
      artists: [{ id: "A", name: "Leonardo", birthYear: null, deathYear: null, sitelinks: 1 }],
      movements: [], artistMovements: [], artworkMovements: [], museumMovementHoldings: [], genres: [], artworkGenres: [],
      museums: [louvre, paintings, prints],
      artworks: [{ id: "W", title: "Mona Lisa", artistId: "A", year: null, imageFile: null, sitelinks: 1, museumId: "Q3044768", inPool: true }],
      museumArtistHoldings: [{ museumId: "Q3044768", artistId: "A", paintingCount: 6 }],
    };
    const n = normalizeDataset(ds, parents);
    expect(n.museums.map((m) => m.id)).toEqual(["Q19675"]);
    expect(n.artworks[0].museumId).toBe("Q19675");
    expect(n.museumArtistHoldings[0].museumId).toBe("Q19675");
  });

  it("derives movement holdings and remaps merged museums", () => {
    const ds: Dataset = {
      artists: [{ id: "A", name: "Monet", birthYear: null, deathYear: null, sitelinks: 1 }],
      movements: [{ id: "IMP", name: "Impressionism" }],
      artistMovements: [{ artistId: "A", movementId: "IMP" }],
      museums: [mus("Q1", "Musée Marmottan Monet", 48.8594, 2.2675, 40), mus("Q2", "Fondation Marmottan", 48.8594, 2.2675, 3)],
      artworks: [{ id: "W", title: "t", artistId: "A", year: null, imageFile: null, sitelinks: 1, museumId: "Q2", inPool: true }],
      artworkMovements: [],
      genres: [],
      artworkGenres: [],
      museumArtistHoldings: [
        { museumId: "Q1", artistId: "A", paintingCount: 94 },
        { museumId: "Q2", artistId: "A", paintingCount: 90 },
      ],
      museumMovementHoldings: [],
    };
    const n = normalizeDataset(ds);
    expect(n.museums.map((m) => m.id)).toEqual(["Q1"]);
    expect(n.artworks[0].museumId).toBe("Q1");
    expect(n.museumArtistHoldings).toEqual([{ museumId: "Q1", artistId: "A", paintingCount: 94 }]);
    expect(n.museumMovementHoldings).toEqual([{ museumId: "Q1", movementId: "IMP", paintingCount: 94 }]);
  });
});
