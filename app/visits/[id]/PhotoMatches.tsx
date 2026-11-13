"use client";

import { useEffect, useState } from "react";
import { embedPhoto, scanModelCached } from "@/lib/client/clip";
import { SCAN } from "@/lib/algo/config";

export type PhotoMatch = { id: string; title: string; year: number | null; artistName: string; nudity: boolean; thumbUrl: string | null; similarity: number };
type State =
  | { kind: "idle" }
  | { kind: "working"; progress: number | null }
  | { kind: "done"; matches: PhotoMatch[]; notFound: boolean }
  | { kind: "error" };

/**
 * "From your photo": embeds the photo in the browser and shows the closest
 * catalogue paintings (this museum's first). Series and near-copies make a
 * single automatic answer unreliable, so the person confirms one. The first
 * run downloads the matcher, so it starts on a tap; after that, automatically.
 */
export function PhotoMatches({
  photoUrl,
  museumId,
  hideNudity,
  busy,
  currentId,
  onPick,
}: {
  photoUrl: string;
  museumId: string;
  hideNudity: boolean;
  busy: boolean;
  currentId: string | null;
  onPick: (artworkId: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const run = async () => {
    setState({ kind: "working", progress: scanModelCached() ? null : 0 });
    try {
      const blob = await (await fetch(photoUrl)).blob();
      const vector = await embedPhoto(blob, { onProgress: (p) => setState({ kind: "working", progress: p }) });
      const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vector, museumId }) });
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { matches: PhotoMatch[]; notFound: boolean };
      setState({ kind: "done", matches: j.matches.slice(0, SCAN.show), notFound: j.notFound });
    } catch {
      setState({ kind: "error" });
    }
  };

  useEffect(() => {
    if (scanModelCached()) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoUrl]);

  if (state.kind === "idle")
    return (
      <button type="button" onClick={run} className="mx-2 mb-3 flex w-[calc(100%-1rem)] items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-left hover:border-ink-2">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden className="shrink-0 text-ink-2">
          <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
        <span>
          <span className="block font-medium">Find it from the photo</span>
          <span className="block text-xs text-ink-2">Matches your photo against the catalogue on this device. First time downloads about 90 MB.</span>
        </span>
      </button>
    );
  if (state.kind === "working")
    return (
      <p className="mx-2 mb-3 rounded-xl bg-surface px-4 py-3 text-sm text-ink-2" role="status">
        {state.progress != null && state.progress < 1 ? `Getting the matcher ready… ${Math.round(state.progress * 100)}%` : "Looking at your photo…"}
      </p>
    );
  if (state.kind === "error")
    return (
      <p className="mx-2 mb-3 rounded-xl bg-surface px-4 py-3 text-sm text-ink-2">
        Couldn&apos;t match this photo. Pick it from the list below.{" "}
        <button type="button" onClick={run} className="underline underline-offset-2">
          Try again
        </button>
      </p>
    );
  return (
    <div className="mb-3">
      <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-ink-2 uppercase">
        {state.notFound ? "Not sure. Is it one of these?" : "From your photo: best matches"}
      </p>
      <ul>
        {state.matches.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(m.id)}
              className={`flex w-full items-center gap-4 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface ${currentId === m.id ? "bg-surface" : ""}`}
            >
              <span className="flex size-14 shrink-0 items-center justify-center">
                {m.thumbUrl && hideNudity && m.nudity ? (
                  <span className="grid size-12 place-items-center rounded bg-line text-[10px] leading-tight text-ink-2">Nudity</span>
                ) : m.thumbUrl ? (
                  <img src={m.thumbUrl} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="size-12 rounded bg-line" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <i className="block truncate font-serif text-base">{m.title}</i>
                <span className="block truncate text-sm text-ink-2">
                  {m.artistName}
                  {m.year != null && `, ${m.year}`}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-2">{Math.round(m.similarity * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>
      {state.notFound && <p className="px-2 pt-1 text-xs text-ink-2">It may not be in our catalogue. Search below or add it by hand.</p>}
      <hr className="mx-2 mt-3 border-line" />
    </div>
  );
}
