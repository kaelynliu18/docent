import type { Answer, Comparison } from "./insertion";
import { BANDS, scoreAt } from "./scoring";
import { blendedTierScores, btTierScores } from "./bradleyTerry";
import { buildTaste } from "./taste";
import { predictScore } from "./predict";
import { DEFAULT_TRUTH, gaussian, makeUser, mulberry32, shuffle, spearman, type EvalItem, type TruthWeights } from "./evaluate";
import { TIERS, type RankedForTaste, type Tier } from "./types";

/**
 * Whole ranking sessions with simulated people, to compare how scores are
 * displayed (score fidelity) and how many questions placing a painting takes.
 *
 * Each person has a hidden reaction to every painting (makeUser). Their "true"
 * 0–10 score is 5 + 5·tanh(u / scale). They pick a tier from a noisy reading
 * of that score, then answer "which do you prefer?" from their reactions plus
 * comparison noise; near-equal pairs sometimes get "too close to call".
 */
export type SessionOpts = {
  paintings?: number; // per person
  tierNoise?: number; // sd on the 0–10 scale when choosing a tier
  compareNoise?: number; // sd on the utility scale when comparing
  tieBand?: number; // |difference| below which they say "too close" (utility scale)
  scale?: number; // utility → score squash
  truth?: TruthWeights;
};

export type Strategy = "bisect" | "guess-first" | "gallop" | "nudge";

/* ───────── Guided insertion (experiment; plain bisection won, see docs/decisions.md) ───────── */

/**
 * Insertion search that may start from a predicted slot. Same contract as
 * lib/algo/insertion.ts (always finds the exact slot), different question order:
 *  - bisect: middle every time (what ships)
 *  - guess-first: first question at the predicted slot, then bisection
 *  - gallop: exponential search outward from the predicted slot
 *  - nudge: first question halfway between the middle and the prediction
 */
export type GuidedState = {
  items: string[];
  lo: number;
  hi: number;
  asked: number;
  comparisons: Comparison[];
  newId: string;
  guess: number | null;
  step: number;
  strategy: Strategy;
  index: number | null;
};

export function startGuided(newId: string, items: string[], guess: number | null, strategy: Strategy): GuidedState {
  return { newId, items, lo: 0, hi: items.length, asked: 0, comparisons: [], guess, step: 1, strategy, index: items.length === 0 ? 0 : null };
}

function anchorOf(s: GuidedState): number | null {
  if (s.guess == null || s.strategy === "bisect" || s.strategy === "nudge") return null;
  if (s.strategy === "guess-first" && s.asked > 0) return null;
  return Math.min(s.hi, Math.max(s.lo, Math.round(s.guess)));
}

export function guidedProbe(s: GuidedState): number | null {
  if (s.index !== null) return null;
  const mid = Math.floor((s.lo + s.hi) / 2);
  if (s.strategy === "nudge") {
    return s.asked === 0 && s.guess != null ? Math.min(s.hi - 1, Math.max(s.lo, Math.round((mid + s.guess - 0.5) / 2))) : mid;
  }
  const a = anchorOf(s);
  if (a !== null) {
    if (a > s.lo) return a - 1; // worse than the one just above the predicted slot?
    if (a < s.hi) return a; // better than the one at it?
  }
  return mid;
}

export function guidedAnswer(s: GuidedState, ans: Answer): GuidedState {
  const p = guidedProbe(s);
  if (p === null) return s;
  const other = s.items[p];
  const comparisons = [
    ...s.comparisons,
    ans === "item" ? { winnerId: other, loserId: s.newId, wasTie: false } : { winnerId: s.newId, loserId: other, wasTie: ans === "tie" },
  ];
  if (ans === "tie") return { ...s, asked: s.asked + 1, comparisons, index: p + 1 };
  const lo = ans === "new" ? s.lo : p + 1;
  const hi = ans === "new" ? p : s.hi;
  let { guess, step } = s;
  const a = anchorOf(s);
  if (a !== null && s.strategy === "gallop") {
    if (ans === "new" && p === a - 1) {
      guess = a - step;
      step *= 2;
    } else if (ans === "item" && p === a) {
      guess = a + step;
      step *= 2;
    }
  }
  return { ...s, lo, hi, guess, step, asked: s.asked + 1, comparisons, index: lo < hi ? null : lo };
}

/** Predicted slot among a tier's scores (best first), or null when the prediction is weak. */
export function guessIndex(tierScores: number[], predicted: number | null, confident: boolean): number | null {
  if (predicted == null || !confident || tierScores.length < 3) return null;
  let i = 0;
  while (i < tierScores.length && tierScores[i] > predicted) i++;
  return i;
}
export type ScoreMethod = (tier: Tier, order: string[], comparisons: Comparison[]) => number[];

/** Beli-style display: evenly spaced by position inside fixed tier bands. */
export const evenSpacing: ScoreMethod = (tier, order) => {
  const { min, max } = BANDS[tier];
  const n = order.length;
  if (n === 1) return [(min + max) / 2];
  return order.map((_, i) => max - (i / (n - 1)) * (max - min));
};
/** Docent v1: even spacing shrunk toward the band middle for small tiers. */
export const shrunkSpacing: ScoreMethod = (tier, order) => order.map((_, i) => scoreAt(tier, i, order.length));
/** Midpoint spacing: each painting sits at the centre of its 1/n share of the band. */
export const midpointSpacing: ScoreMethod = (tier, order) => {
  const { min, max } = BANDS[tier];
  const n = order.length;
  return order.map((_, i) => max - ((i + 0.5) / n) * (max - min));
};
/** Bradley–Terry spacing from the comparisons. */
export const btSpacing: ScoreMethod = (tier, order, comps) => btTierScores(tier, order, comps);
/** Half Bradley–Terry, half Docent v1 (what ships). */
export const blendSpacing: ScoreMethod = (tier, order, comps) => blendedTierScores(tier, order, comps);

export const trueScore = (u: number, scale: number) => 5 + 5 * Math.tanh(u / scale);

function tierOf(score: number): Tier {
  return score >= BANDS.loved.min ? "loved" : score >= BANDS.fine.min ? "fine" : "meh";
}

export function simulateSessions(
  items: EvalItem[],
  methods: Record<string, ScoreMethod>,
  strategies: Strategy[],
  opts: SessionOpts & { users?: number; seed?: number } = {},
) {
  const {
    users = 200,
    seed = 7,
    paintings = 30,
    tierNoise = 0.8,
    compareNoise = 0.35,
    tieBand = 0.08,
    scale = 1.5,
    truth = DEFAULT_TRUTH,
  } = opts;
  const fidelity = Object.fromEntries(Object.keys(methods).map((k) => [k, { spearman: 0, mae: 0, pearson: 0 }]));
  const questions = Object.fromEntries(strategies.map((s) => [s, { asked: 0, placed: 0, exact: true }]));

  for (let u = 0; u < users; u++) {
    const rng = mulberry32(seed * 7919 + u);
    const util = makeUser(rng, truth);
    const order = shuffle(items, rng).slice(0, paintings);
    const truthScore = new Map(order.map((it) => [it.id, trueScore(util(it), scale)]));
    const tierPick = new Map(order.map((it) => [it.id, tierOf(truthScore.get(it.id)! + tierNoise * gaussian(rng))]));
    // Comparison noise is drawn per question, but the same for every strategy (seeded by the pair).
    const prefer = (newIt: EvalItem, other: EvalItem): "new" | "item" | "tie" => {
      const pr = mulberry32(hash(`${u}:${newIt.id}:${other.id}`));
      const d = util(newIt) - util(other) + compareNoise * gaussian(pr);
      if (Math.abs(d) < tieBand) return "tie";
      return d > 0 ? "new" : "item";
    };

    for (const strategy of strategies) {
      const lists: Record<Tier, string[]> = { loved: [], fine: [], meh: [] };
      const comps: Record<Tier, Comparison[]> = { loved: [], fine: [], meh: [] };
      const byId = new Map(order.map((it) => [it.id, it]));
      for (const it of order) {
        const tier = tierPick.get(it.id)!;
        const list = lists[tier];
        let guess: number | null = null;
        if (strategy !== "bisect") {
          // Predict from what's ranked so far (any tier), place among this tier's displayed scores.
          const ranked = rankedSoFar(lists, byId);
          const p = predictScore(it, buildTaste(ranked));
          guess = guessIndex(list.map((_, i) => scoreAt(tier, i, list.length)), p.score, p.confidence === "normal");
        }
        let s = startGuided(it.id, list, guess, strategy);
        while (s.index === null) s = guidedAnswer(s, prefer(it, byId.get(list[guidedProbe(s)!])!));
        questions[strategy].asked += s.comparisons.length;
        questions[strategy].placed += 1;
        // Exactness check: the slot must respect every answer given.
        list.splice(s.index, 0, it.id);
        comps[tier].push(...s.comparisons);
      }
      if (strategy === strategies[0]) {
        for (const [name, method] of Object.entries(methods)) {
          const shown: number[] = [];
          const real: number[] = [];
          for (const tier of TIERS) {
            const sc = lists[tier].length ? method(tier, lists[tier], comps[tier]) : [];
            lists[tier].forEach((id, i) => {
              shown.push(sc[i]);
              real.push(truthScore.get(id)!);
            });
          }
          fidelity[name].spearman += spearman(shown, real);
          fidelity[name].pearson += pearson(shown, real);
          fidelity[name].mae += shown.reduce((acc, x, i) => acc + Math.abs(x - real[i]), 0) / shown.length;
        }
      }
    }
  }
  for (const k of Object.keys(fidelity)) {
    fidelity[k].spearman /= users;
    fidelity[k].pearson /= users;
    fidelity[k].mae /= users;
  }
  const perPainting = Object.fromEntries(strategies.map((s) => [s, questions[s].asked / questions[s].placed]));
  return { fidelity, questionsPerPainting: perPainting };
}

function rankedSoFar(lists: Record<Tier, string[]>, byId: Map<string, EvalItem>): RankedForTaste[] {
  const out: RankedForTaste[] = [];
  for (const tier of TIERS) {
    const l = lists[tier];
    l.forEach((id, i) => {
      const it = byId.get(id)!;
      out.push({
        artworkId: id,
        artistId: it.artistId,
        artistName: it.artistName,
        score: scoreAt(tier, i, l.length),
        movements: it.movementIds.map((m) => ({ id: m, name: m, source: "artwork" as const })),
        genres: it.genreIds.map((g) => ({ id: g, name: g })),
        year: it.year,
      });
    });
  }
  return out;
}

export function pearson(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
