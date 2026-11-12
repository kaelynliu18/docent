"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  answer as answerStep,
  currentOpponent,
  progress,
  slotNeighbours,
  startInsertion,
  type Answer,
  type InsertionState,
} from "@/lib/algo/insertion";
import { TIER_LABEL, type Tier } from "@/lib/algo/types";
import type { ArtworkCard } from "@/lib/server/data";
import { equalAreaSizes, type Size } from "@/lib/algo/equalArea";
import { WallLabel } from "@/components/WallLabel";
import { preloadImage, useImagesReady } from "@/components/useImagesReady";

type TierItem = { artworkId: string; title: string; artistName: string; imageUrl: string | null };
type Phase =
  | { kind: "tier" }
  | { kind: "compare"; tier: Tier; items: TierItem[]; s: InsertionState; flip: boolean }
  | { kind: "saving" };

const UNLOCK_AT = 5;

/** A tick on each choice where the device supports it (Android; iOS Safari ignores vibrate). */
const tick = (ms = 8) => {
  try {
    navigator.vibrate?.(ms);
  } catch {}
};

async function fetchTier(tier: Tier): Promise<TierItem[]> {
  const r = await fetch(`/api/rankings?tier=${tier}`, { cache: "no-store" });
  if (!r.ok) throw new Error("tier");
  return (await r.json()).items;
}

export function RankClient({
  initialQueue,
  initialRanked,
  visitId,
}: {
  initialQueue: ArtworkCard[];
  initialRanked: number;
  visitId: string | null;
}) {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<ArtworkCard[]>(initialQueue);
  const [phase, setPhase] = useState<Phase>({ kind: "tier" });
  const [toast, setToast] = useState<string | null>(null);
  const [ranked, setRanked] = useState(initialRanked);
  const [done, setDone] = useState(0);

  const current = queue[0] ?? null;

  const flash = useCallback((msg: string, ms = 1400) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), ms);
  }, []);

  /* Preload the next few photos. */
  useEffect(() => {
    for (const a of queue.slice(0, 4)) preloadImage(a.imageUrl);
  }, [queue]);

  /* Prefetch the three tiers so picking one is instant. */
  useEffect(() => {
    for (const t of ["loved", "fine", "meh"] as Tier[]) {
      qc.prefetchQuery({ queryKey: ["tier", t], queryFn: () => fetchTier(t) });
    }
  }, [qc, ranked]);

  // Lets save() restart a search after a 409 without a circular hook dependency.
  const pickTierRef = useRef<((t: Tier) => Promise<void>) | null>(null);

  const advance = useCallback(() => {
    setQueue((q) => q.slice(1));
    setDone((n) => n + 1);
    setPhase({ kind: "tier" });
  }, []);

  const save = useCallback(
    async (s: InsertionState, tier: Tier) => {
      if (!current) return;
      setPhase({ kind: "saving" });
      const r = await fetch("/api/rankings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artworkId: current.id, tier, ...slotNeighbours(s), comparisons: s.comparisons }),
      });
      if (r.status === 201) {
        const { ranking, score } = await r.json();
        qc.invalidateQueries({ queryKey: ["tier"] });
        qc.invalidateQueries({ queryKey: ["pending"] });
        tick(18);
        setRanked((n) => n + 1);
        flash(`Placed #${ranking.tierIndex + 1} in ${TIER_LABEL[tier]} · ${score.toFixed(1)}`, 900);
        advance();
        return;
      }
      const body = await r.json().catch(() => null);
      flash(body?.error?.message ?? "Something went wrong. Try again.", 2400);
      if (r.status === 409) {
        // Slot moved (another tab) or already ranked: restart cleanly.
        await qc.invalidateQueries({ queryKey: ["tier"] });
        if (body?.error?.code === "already_ranked") return advance();
        return pickTierRef.current?.(tier);
      }
      setPhase({ kind: "tier" });
    },
    [current, qc, flash, advance],
  );

  const pickTier = useCallback(
    async (tier: Tier) => {
      if (!current) return;
      const items = await qc.fetchQuery({ queryKey: ["tier", tier], queryFn: () => fetchTier(tier) });
      const s = startInsertion(current.id, items.map((i) => i.artworkId));
      if (s.index !== null) return save(s, tier);
      setPhase({ kind: "compare", tier, items, s, flip: Math.random() < 0.5 });
    },
    [current, qc, save],
  );
  pickTierRef.current = pickTier;

  const choose = useCallback(
    (a: Answer) => {
      if (phase.kind !== "compare") return;
      tick();
      const s = answerStep(phase.s, a);
      if (s.index !== null) return save(s, phase.tier);
      setPhase({ ...phase, s, flip: Math.random() < 0.5 });
    },
    [phase, save],
  );

  const skip = useCallback(async () => {
    if (!current) return;
    fetch("/api/skips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artworkId: current.id }),
    }).then(() => qc.invalidateQueries({ queryKey: ["pending"] }));
    advance();
  }, [current, advance, qc]);

  /* Keyboard: 1 2 3 tiers, S skip; ← → pick, T tie, Esc back. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (phase.kind === "tier") {
        if (e.key === "1") pickTier("loved");
        else if (e.key === "2") pickTier("fine");
        else if (e.key === "3") pickTier("meh");
        else if (e.key.toLowerCase() === "s") skip();
        else return;
      } else if (phase.kind === "compare") {
        const leftIsNew = !phase.flip;
        if (e.key === "ArrowLeft") choose(leftIsNew ? "new" : "item");
        else if (e.key === "ArrowRight") choose(leftIsNew ? "item" : "new");
        else if (e.key.toLowerCase() === "t") choose("tie");
        else if (e.key === "Escape") setPhase({ kind: "tier" });
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, pickTier, choose, skip]);

  if (!current) {
    const any = done > 0;
    return (
      <section className="mx-auto max-w-md py-24 text-center">
        <h1 className="font-serif text-4xl">{any ? "All caught up" : "Nothing to rank yet"}</h1>
        <p className="mt-3 text-ink-2">
          {any
            ? "Every painting you photographed has its place."
            : "Log a museum visit and add the photos you took. Each painting you identify lands here to rank."}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {any ? (
            <>
              <Link href="/list" className="rounded-full bg-ink px-6 py-3 text-wall hover:opacity-90">
                See my list
              </Link>
              <Link href={visitId ? `/visits/${visitId}` : "/visits"} className="rounded-full px-5 py-3 text-ink-2 hover:text-ink">
                {visitId ? "Back to the visit" : "My visits"}
              </Link>
            </>
          ) : (
            <Link href="/visits/new" className="rounded-full bg-ink px-6 py-3 text-wall hover:opacity-90">
              Log a visit
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-live="polite">
      <StatusLine ranked={ranked} left={queue.length} />
      {phase.kind === "compare" ? (
        <Compare current={current} phase={phase} onChoose={choose} onBack={() => setPhase({ kind: "tier" })} />
      ) : (
        <TierStep art={current} busy={phase.kind === "saving"} onTier={pickTier} onSkip={skip} />
      )}
      {toast && (
        <div role="status" className="toast fixed bottom-6 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-5 py-2.5 text-sm text-wall shadow-hung">
          {toast}
        </div>
      )}
    </section>
  );
}

function StatusLine({ ranked, left }: { ranked: number; left: number }) {
  const toUnlock = Math.max(0, UNLOCK_AT - ranked);
  return (
    <p className="mb-2 text-sm text-ink-2 sm:mb-4">
      {left} left from your visits · {ranked} ranked
      {toUnlock > 0 ? (
        <> · {toUnlock} more to unlock museum matches</>
      ) : (
        <>
          {" · "}
          <Link className="underline decoration-line underline-offset-2 hover:text-ink" href="/museums">
            see your museum matches
          </Link>
        </>
      )}
    </p>
  );
}

function TierStep({
  art,
  busy,
  onTier,
  onSkip,
}: {
  art: ArtworkCard;
  busy: boolean;
  onTier: (t: Tier) => void;
  onSkip: () => void;
}) {
  const ready = useImagesReady([art.imageUrl]);
  return (
    <div className="grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_18rem] md:gap-8">
      <div className="flex min-h-[24dvh] items-center justify-center md:min-h-[40vh]">
        {ready ? (
           
          <img
            key={art.id}
            src={art.imageUrl ?? ""}
            alt={`${art.title} by ${art.artistName}`}
            className="painting fade-in max-h-[38dvh] w-auto [@media(max-height:740px)]:max-h-[32dvh] max-w-full object-contain md:max-h-[68vh]"
          />
        ) : (
          <div className="painting h-[34dvh] w-full max-w-md animate-pulse opacity-60 md:h-[50vh]" aria-label="Loading painting" />
        )}
      </div>
      <div className="flex flex-col gap-4 md:gap-6">
        <WallLabel art={art} />
        {/* Phones: three tiers side by side so they sit above the tab bar without scrolling. */}
        <div className="grid grid-cols-3 gap-2 md:flex md:flex-col" role="group" aria-label="How did you feel about it?">
          {(["loved", "fine", "meh"] as Tier[]).map((t, i) => (
            <button
              key={t}
              type="button"
              disabled={busy}
              onClick={() => onTier(t)}
              className={`flex items-center justify-center rounded-xl border px-2 py-3.5 text-center text-sm transition-colors active:scale-[0.98] disabled:opacity-50 md:justify-between md:px-4 md:py-3 md:text-left md:text-base ${
                t === "loved"
                  ? "border-loved bg-loved text-accent-ink hover:opacity-90"
                  : "border-line bg-surface hover:border-ink-2"
              }`}
            >
              <span className="font-medium">{TIER_LABEL[t]}</span>
              <kbd className={`max-md:hidden ${t === "loved" ? "border-accent-ink/40 text-accent-ink" : ""}`}>{i + 1}</kbd>
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={onSkip}
            className="col-span-3 flex items-center justify-center rounded-xl px-4 py-2 text-sm text-ink-2 hover:text-ink md:mt-1 md:justify-between"
          >
            <span>Don&apos;t rank this one</span>
            <kbd className="max-md:hidden">S</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

function Compare({
  current,
  phase,
  onChoose,
  onBack,
}: {
  current: ArtworkCard;
  phase: Extract<Phase, { kind: "compare" }>;
  onChoose: (a: Answer) => void;
  onBack: () => void;
}) {
  const oppId = currentOpponent(phase.s)!;
  const opp = phase.items.find((i) => i.artworkId === oppId)!;
  const ready = useImagesReady([current.imageUrl, opp.imageUrl]);
  const { asked, max } = progress(phase.s);

  // Warm up the next possible opponents so the following question is instant.
  useEffect(() => {
    const { lo, hi } = phase.s;
    const mid = Math.floor((lo + hi) / 2);
    for (const [a, b] of [[lo, mid], [mid + 1, hi]]) {
      if (a < b) preloadImage(phase.items[Math.floor((a + b) / 2)]?.imageUrl);
    }
  }, [phase]);

  const sides = useMemo(() => {
    const mine = { id: current.id, title: current.title, artist: current.artistName, img: current.imageUrl, ans: "new" as Answer };
    const theirs = { id: opp.artworkId, title: opp.title, artist: opp.artistName, img: opp.imageUrl, ans: "item" as Answer };
    return phase.flip ? [theirs, mine] : [mine, theirs];
  }, [current, opp, phase.flip]);

  // Same screen area for both paintings, proportions untouched, so shape can't sway the choice.
  const frameRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Record<string, Size>>({});
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, oppId]);
  const noteSize = (id: string) => (e: React.SyntheticEvent<HTMLImageElement>) => {
    const im = e.currentTarget;
    if (im.naturalWidth) setNatural((n) => (n[id] ? n : { ...n, [id]: { w: im.naturalWidth, h: im.naturalHeight } }));
  };
  const sized = box && sides.every((sd) => natural[sd.id]) ? equalAreaSizes(box, sides.map((sd) => natural[sd.id])) : null;

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-4 sm:mb-6">
        <div>
          <p className="text-sm text-ink-2">{TIER_LABEL[phase.tier]}</p>
          <h1 className="font-serif text-2xl sm:text-3xl">Which do you prefer?</h1>
        </div>
        <div className="w-32 sm:w-48" aria-label={`Question ${asked + 1} of at most ${max}`}>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${(asked / max) * 100}%` }} />
          </div>
          <p className="mt-1 text-right text-xs text-ink-2">
            {asked + 1} of ≤{max}
          </p>
        </div>
      </div>

      {ready ? (
        <div key={oppId + String(phase.flip)} className="fade-in flex flex-col gap-1 min-[600px]:flex-row min-[600px]:gap-4">
          {sides.map((side, i) => (
            <button
              key={side.id}
              type="button"
              onClick={() => onChoose(side.ans)}
              className="group flex flex-1 flex-col items-center gap-2 rounded-2xl p-2 transition-colors hover:bg-surface sm:gap-3 sm:p-3"
            >
              {/* Identical frames, and equal painting area inside them. */}
              <span ref={i === 0 ? frameRef : undefined} className="flex h-[27vh] w-full items-center justify-center min-[600px]:h-[52vh]">
                <img
                  src={side.img ?? ""}
                  alt={`${side.title} by ${side.artist}`}
                  onLoad={noteSize(side.id)}
                  ref={(im) => {
                    if (im?.complete && im.naturalWidth && !natural[side.id]) noteSize(side.id)({ currentTarget: im } as React.SyntheticEvent<HTMLImageElement>);
                  }}
                  style={sized ? { width: sized[i].w, height: sized[i].h, opacity: 1 } : { opacity: 0 }}
                  className="painting max-h-full max-w-full object-contain transition-opacity duration-150"
                />
              </span>
              <span className="text-center text-sm">
                <i className="font-serif text-base">{side.title}</i>
                <span className="block text-ink-2">
                  {side.artist} <kbd className="ml-1 max-md:hidden">{i === 0 ? "←" : "→"}</kbd>
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4 min-[600px]:flex-row" aria-label="Loading paintings">
          <div className="painting h-[27vh] flex-1 animate-pulse opacity-60 min-[600px]:h-[52vh]" />
          <div className="painting h-[27vh] flex-1 animate-pulse opacity-60 min-[600px]:h-[52vh]" />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-sm sm:mt-6">
        <button type="button" onClick={() => onChoose("tie")} className="rounded-full border border-line bg-surface px-4 py-2 hover:border-ink-2">
          Too close to call <kbd className="ml-1 max-md:hidden">T</kbd>
        </button>
        <button type="button" onClick={onBack} className="rounded-full px-4 py-2 text-ink-2 hover:text-ink">
          Change tier <kbd className="ml-1 max-md:hidden">Esc</kbd>
        </button>
      </div>
    </div>
  );
}
