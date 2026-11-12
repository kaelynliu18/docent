/**
 * 6.1 Binary insertion. Index 0 is the top (best) of the tier.
 * Pure state machine: the client holds this state until placement is final.
 */
export type Comparison = { winnerId: string; loserId: string; wasTie: boolean };

export type InsertionState = {
  newId: string;
  items: string[];
  lo: number;
  hi: number;
  comparisons: Comparison[];
  /** Set once the search is finished. Index where the new item lands. */
  index: number | null;
};

export type Answer = "new" | "item" | "tie";

export function maxQuestions(n: number): number {
  return Math.ceil(Math.log2(n + 1));
}

export function startInsertion(newId: string, items: string[]): InsertionState {
  const n = items.length;
  return { newId, items, lo: 0, hi: n, comparisons: [], index: n === 0 ? 0 : null };
}

export function currentMid(s: InsertionState): number | null {
  if (s.index !== null) return null;
  return Math.floor((s.lo + s.hi) / 2);
}

export function currentOpponent(s: InsertionState): string | null {
  const mid = currentMid(s);
  return mid === null ? null : s.items[mid];
}

export function answer(s: InsertionState, a: Answer): InsertionState {
  const mid = currentMid(s);
  if (mid === null) return s;
  const other = s.items[mid];
  if (a === "tie") {
    return {
      ...s,
      comparisons: [...s.comparisons, { winnerId: s.newId, loserId: other, wasTie: true }],
      index: mid + 1, // directly below item[mid]
    };
  }
  const comparisons = [
    ...s.comparisons,
    a === "new"
      ? { winnerId: s.newId, loserId: other, wasTie: false }
      : { winnerId: other, loserId: s.newId, wasTie: false },
  ];
  const lo = a === "new" ? s.lo : mid + 1;
  const hi = a === "new" ? mid : s.hi;
  return { ...s, lo, hi, comparisons, index: lo < hi ? null : lo };
}

/** Neighbours of the final slot, sent to the server so it can verify adjacency. */
export function slotNeighbours(s: InsertionState): { aboveId: string | null; belowId: string | null } {
  if (s.index === null) throw new Error("search not finished");
  return { aboveId: s.items[s.index - 1] ?? null, belowId: s.items[s.index] ?? null };
}

/** Questions asked so far vs. the worst case, for the progress bar. */
export function progress(s: InsertionState): { asked: number; max: number } {
  return { asked: s.comparisons.length, max: Math.max(1, maxQuestions(s.items.length)) };
}
