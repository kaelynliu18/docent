import { haversineKm } from "@/lib/algo/match";
import type { Dataset, MuseumRow } from "./types";

const GENERIC = new Set([
  "museum", "museo", "musee", "musée", "museu", "museum", "gallery", "galleria", "galerie",
  "national", "nationale", "nazionale", "nacional", "art", "arts", "fine", "kunst", "of", "the",
  "de", "des", "del", "der", "di", "and", "foundation", "fondation", "collection", "city", "royal",
]);

function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !GENERIC.has(t)),
  );
}

/**
 * Duplicate museums (a museum and its parent foundation) share coordinates.
 * Merge pairs within 200 m that also share a distinctive name token, so
 * neighbours like the buildings on Berlin's Museum Island stay separate.
 * Returns dup → keeper (the one with more sitelinks).
 */
export function findDuplicateMuseums(museums: MuseumRow[], radiusM = 200): Map<string, string> {
  const located = museums.filter((m) => m.lat != null && m.lon != null);
  const sorted = [...located].sort((a, b) => b.sitelinks - a.sitelinks);
  const remap = new Map<string, string>();
  for (let i = 0; i < sorted.length; i++) {
    const keep = sorted[i];
    if (remap.has(keep.id)) continue;
    const kt = tokens(keep.name);
    for (let j = i + 1; j < sorted.length; j++) {
      const dup = sorted[j];
      if (remap.has(dup.id)) continue;
      if (Math.abs(dup.lat! - keep.lat!) > 0.01) continue;
      const d = haversineKm({ lat: keep.lat!, lon: keep.lon! }, { lat: dup.lat!, lon: dup.lon! });
      if (d * 1000 > radiusM) continue;
      const shared = [...tokens(dup.name)].some((t) => kt.has(t));
      if (shared || d * 1000 < 5) remap.set(dup.id, keep.id);
    }
  }
  return remap;
}

/**
 * Departments roll up into their parent museum: Wikidata files most Louvre
 * paintings under "Department of Paintings of the Louvre". Only small items
 * (≤ 5 sitelinks) within 200 m of a better-known parent are rolled up, so
 * real museums that are "part of" an umbrella organization stay separate.
 */
export function findDepartmentParents(museums: MuseumRow[], parents: Map<string, string[]>): Map<string, string> {
  const byId = new Map(museums.map((m) => [m.id, m]));
  const remap = new Map<string, string>();
  for (const [childId, ps] of parents) {
    const child = byId.get(childId);
    if (!child || child.sitelinks > 5 || child.lat == null || child.lon == null) continue;
    const best = ps
      .map((id) => byId.get(id))
      .filter((p): p is MuseumRow => !!p && p.lat != null && p.lon != null && p.sitelinks > child.sitelinks)
      .filter((p) => haversineKm({ lat: child.lat!, lon: child.lon! }, { lat: p.lat!, lon: p.lon! }) <= 0.2)
      .sort((a, b) => b.sitelinks - a.sitelinks)[0];
    if (best) remap.set(childId, best.id);
  }
  // Collapse chains (child → parent → grandparent).
  for (const [k, v] of remap) {
    let t = v;
    for (let i = 0; i < 5 && remap.has(t); i++) t = remap.get(t)!;
    remap.set(k, t);
  }
  return remap;
}

/** Apply museum merges, drop dangling references, derive movement holdings. */
export function normalizeDataset(ds: Dataset, parents: Map<string, string[]> = new Map()): Dataset {
  const dept = findDepartmentParents(ds.museums, parents);
  const remainingAfterDept = ds.museums.filter((m) => !dept.has(m.id));
  const dupes = findDuplicateMuseums(remainingAfterDept);
  const remap = new Map<string, string>([...dept, ...dupes]);
  for (const [k, v] of remap) if (dupes.has(v)) remap.set(k, dupes.get(v)!);
  const museums = ds.museums.filter((m) => !remap.has(m.id));
  const museumIds = new Set(museums.map((m) => m.id));
  const fix = (id: string | null) => {
    const r = id ? (remap.get(id) ?? id) : null;
    return r && museumIds.has(r) ? r : null;
  };

  // A painting can be counted under both a museum and its foundation: take the max.
  const holdings = new Map<string, { museumId: string; artistId: string; paintingCount: number }>();
  for (const h of ds.museumArtistHoldings) {
    const museumId = fix(h.museumId);
    if (!museumId) continue;
    const k = `${museumId}|${h.artistId}`;
    const prev = holdings.get(k);
    if (!prev || prev.paintingCount < h.paintingCount) holdings.set(k, { ...h, museumId });
  }

  const artistIds = new Set(ds.artists.map((a) => a.id));
  const artworks = ds.artworks
    .filter((w) => artistIds.has(w.artistId))
    .map((w) => ({ ...w, museumId: fix(w.museumId) }));
  const artworkIds = new Set(artworks.map((w) => w.id));
  const museumArtistHoldings = [...holdings.values()].filter((h) => artistIds.has(h.artistId));

  // g_{u,m}: paintings at museum u by artists associated with movement m.
  // Derived from artist holdings so it costs no extra Wikidata queries.
  const artistMoves = new Map<string, string[]>();
  for (const am of ds.artistMovements) {
    const l = artistMoves.get(am.artistId) ?? [];
    l.push(am.movementId);
    artistMoves.set(am.artistId, l);
  }
  const mm = new Map<string, number>();
  for (const h of museumArtistHoldings) {
    for (const m of artistMoves.get(h.artistId) ?? []) {
      const k = `${h.museumId}|${m}`;
      mm.set(k, (mm.get(k) ?? 0) + h.paintingCount);
    }
  }
  const museumMovementHoldings = [...mm].map(([k, paintingCount]) => {
    const [museumId, movementId] = k.split("|");
    return { museumId, movementId, paintingCount };
  });

  return {
    ...ds,
    museums,
    artworks,
    artworkMovements: ds.artworkMovements.filter((x) => artworkIds.has(x.artworkId)),
    genres: ds.genres ?? [],
    artworkGenres: (ds.artworkGenres ?? []).filter((x) => artworkIds.has(x.artworkId)),
    artistMovements: ds.artistMovements.filter((x) => artistIds.has(x.artistId)),
    museumArtistHoldings,
    museumMovementHoldings,
  };
}
