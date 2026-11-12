import { periodOf } from "./taste";
import { PREDICT_WEIGHTS } from "./predict";
import type { ArtworkFeatures, TasteProfile } from "./types";

/**
 * Why a prediction came out the way it did, in terms a person recognises:
 * the one or two taste dimensions that moved it most, each with the ranked
 * paintings behind it ("Because you loved The Starry Night and Café Terrace").
 * Mirrors the terms of predictScore so the explanation matches the number.
 */
export type RankedRef = ArtworkFeatures & { id: string; title: string; score: number };

export type Reason = {
  kind: "artist" | "movement" | "genre" | "period" | "content";
  id: string;
  name: string;
  contribution: number;
  examples: { id: string; title: string; score: number }[];
};

export function explainPrediction(
  art: ArtworkFeatures,
  taste: TasteProfile,
  ranked: RankedRef[],
  opts: { weights?: typeof PREDICT_WEIGHTS; max?: number } = {},
): Reason[] {
  const w = opts.weights ?? PREDICT_WEIGHTS;
  const terms: Omit<Reason, "examples">[] = [];
  const a = taste.artists.get(art.artistId);
  if (a) terms.push({ kind: "artist", id: a.id, name: a.name, contribution: w.artist * a.affinity });
  for (const id of art.movementIds) {
    const m = taste.movements.get(id);
    if (m) terms.push({ kind: "movement", id, name: m.name, contribution: (w.movement * m.affinity) / art.movementIds.length });
  }
  const genres = art.genreIds ?? [];
  for (const id of genres) {
    const g = taste.genres.get(id);
    if (g) terms.push({ kind: "genre", id, name: g.name, contribution: (w.genre * g.affinity) / genres.length });
  }
  const p = periodOf(art.year);
  const pa = p ? taste.periods.get(p.id) : undefined;
  if (pa) terms.push({ kind: "period", id: pa.id, name: pa.name, contribution: w.period * pa.affinity });
  for (const t of art.tags ?? []) {
    const c = taste.content.get(t);
    if (c) terms.push({ kind: "content", id: t, name: c.name, contribution: w.content * c.affinity });
  }
  const total = terms.reduce((s, t) => s + t.contribution, 0);
  if (Math.abs(total) < 0.05) return [];
  // Explain the direction the prediction actually went.
  const sign = Math.sign(total);
  const shares = (r: RankedRef, t: Omit<Reason, "examples">) =>
    t.kind === "artist"
      ? r.artistId === t.id
      : t.kind === "movement"
        ? r.movementIds.includes(t.id)
        : t.kind === "genre"
          ? (r.genreIds ?? []).includes(t.id)
          : t.kind === "period"
            ? periodOf(r.year)?.id === t.id
            : (r.tags ?? []).includes(t.id);
  return terms
    .filter((t) => Math.sign(t.contribution) === sign && Math.abs(t.contribution) >= 0.05)
    .sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution))
    .slice(0, opts.max ?? 2)
    .map((t) => ({
      ...t,
      examples: ranked
        .filter((r) => shares(r, t))
        .sort((x, y) => (sign > 0 ? y.score - x.score : x.score - y.score))
        .slice(0, 2)
        .map(({ id, title, score }) => ({ id, title, score })),
    }));
}

const KIND_LABEL: Record<Reason["kind"], string> = {
  artist: "",
  movement: "",
  genre: " paintings",
  period: " art",
  content: "",
};

/** One sentence for the artwork page. */
export function explanationText(reasons: Reason[], cf?: { titles: string[] } | null): string | null {
  const top = reasons[0];
  const titles = (xs: { title: string }[]) => xs.map((x) => x.title).join(" and ");
  if (cf && cf.titles.length) {
    return `People who ranked ${cf.titles.slice(0, 2).join(" and ")} the way you did rated this highly.`;
  }
  if (!top) return null;
  const positive = top.contribution > 0;
  if (top.examples.length) {
    const ex = titles(top.examples);
    if (top.kind === "content") return positive ? `You've ranked paintings with ${top.name.toLowerCase()} highly, like ${ex}.` : `You tend to rank paintings with ${top.name.toLowerCase()} low, like ${ex}.`;
    return positive ? `Because you loved ${ex} (${top.name}${KIND_LABEL[top.kind]}).` : `You ranked ${ex} low (${top.name}${KIND_LABEL[top.kind]}).`;
  }
  return positive ? `You tend to like ${top.name}${KIND_LABEL[top.kind]}.` : `${top.name}${KIND_LABEL[top.kind]} isn't usually your thing.`;
}
