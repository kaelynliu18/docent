import { CONTENT_TAGS, EXCLUDED_ARTIST_IDS, type Affinity, type RankedForTaste, type TasteProfile } from "./types";

/** 10 → +1, 5 → 0, 0 → −1 */
export function signedWeight(score: number): number {
  return (score - 5) / 5;
}

/** 1889 → { id: "C19", name: "19th century" }; BCE years get their own keys. */
export function periodOf(year: number | null | undefined): { id: string; name: string } | null {
  if (year == null || !Number.isFinite(year)) return null;
  const c = year > 0 ? Math.floor((year - 1) / 100) + 1 : -(Math.floor(-year / 100) + 1);
  const n = Math.abs(c);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return { id: `C${c}`, name: `${n}${suffix} century${c < 0 ? " BCE" : ""}` };
}

type Acc = Map<string, { name: string; sum: number; count: number }>;

function add(acc: Acc, id: string, name: string, value: number) {
  const a = acc.get(id) ?? { name, sum: 0, count: 0 };
  a.sum += value;
  a.count += 1;
  acc.set(id, a);
}

function finish(acc: Acc): Map<string, Affinity> {
  const out = new Map<string, Affinity>();
  for (const [id, { name, sum, count }] of acc) out.set(id, { id, name, count, affinity: sum / Math.sqrt(count) });
  return out;
}

/**
 * 6.3 Affinity for each dimension = Σw / √count, so one 9.8 doesn't outweigh
 * five consistent 8s. Movements inherited from the artist count half.
 * Genres and centuries use the same rule.
 */
export function buildTaste(ranked: RankedForTaste[]): TasteProfile {
  const artists: Acc = new Map();
  const movements: Acc = new Map();
  const genres: Acc = new Map();
  const periods: Acc = new Map();
  const content: Acc = new Map();

  for (const r of ranked) {
    // Content counts even for unknown artists: "no nudity" doesn't depend on who painted it.
    for (const t of new Set(r.tags ?? [])) if (CONTENT_TAGS[t]) add(content, t, CONTENT_TAGS[t], signedWeight(r.score));
    if (EXCLUDED_ARTIST_IDS.has(r.artistId)) continue;
    const w = signedWeight(r.score);
    add(artists, r.artistId, r.artistName, w);

    // A painting may list a movement both directly and via its artist: use the stronger.
    const seen = new Map<string, { name: string; f: number }>();
    for (const m of r.movements) {
      const f = m.source === "artwork" ? 1 : 0.5;
      const prev = seen.get(m.id);
      if (!prev || prev.f < f) seen.set(m.id, { name: m.name, f });
    }
    for (const [id, { name, f }] of seen) add(movements, id, name, f * w);

    for (const g of new Map((r.genres ?? []).map((g) => [g.id, g])).values()) add(genres, g.id, g.name, w);
    const p = periodOf(r.year);
    if (p) add(periods, p.id, p.name, w);
  }
  return { artists: finish(artists), movements: finish(movements), genres: finish(genres), periods: finish(periods), content: finish(content) };
}

/** Top positive entries, strongest first. */
export function topPositive(m: Map<string, Affinity>, k: number): Affinity[] {
  return [...m.values()]
    .filter((a) => a.affinity > 0)
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, k);
}

/** Clearest dislikes: affinity below `threshold`, most negative first. */
export function topNegative(m: Map<string, Affinity>, k: number, threshold = -0.15): Affinity[] {
  return [...m.values()]
    .filter((a) => a.affinity < threshold)
    .sort((a, b) => a.affinity - b.affinity)
    .slice(0, k);
}

/** Top entries by |affinity|, used to limit the matcher's inputs. */
export function topAbsolute(m: Map<string, Affinity>, k: number): Affinity[] {
  return [...m.values()].sort((a, b) => Math.abs(b.affinity) - Math.abs(a.affinity)).slice(0, k);
}

export function emptyTaste(): TasteProfile {
  return { artists: new Map(), movements: new Map(), genres: new Map(), periods: new Map(), content: new Map() };
}
