"use client";

import { useEffect, useRef, useState } from "react";
import type { VisitPhoto } from "@/lib/server/visits";
import type { VisitData } from "./VisitClient";

type Candidate = { id: string; title: string; year: number | null; artistName: string; thumbUrl: string | null };

/** Say which painting a photo shows: pick from the museum's list, search everything, or add it by hand. */
export function IdentifyDialog({
  visit,
  photo,
  position,
  onClose,
  onDone,
}: {
  visit: VisitData["visit"];
  photo: VisitPhoto;
  position: { index: number; total: number };
  onClose: () => void;
  onDone: (advance: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"museum" | "all">("museum");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [manual, setManual] = useState(false);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);

  useEffect(() => {
    const id = ++req.current;
    const t = window.setTimeout(async () => {
      const p = new URLSearchParams({ scope });
      if (q.trim()) p.set("q", q.trim());
      const r = await fetch(`/api/visits/${visit.id}/candidates?${p}`);
      if (id === req.current) setResults(r.ok ? await r.json() : []);
    }, q ? 160 : 0);
    return () => window.clearTimeout(t);
  }, [q, scope, visit.id]);

  const send = async (body: object, advance = true) => {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/photos/${photo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => null))?.error?.message ?? "That didn't save. Try again.");
    onDone(advance);
  };

  const remove = async () => {
    if (!window.confirm("Remove this photo from the visit?")) return;
    setBusy(true);
    const r = await fetch(`/api/photos/${photo.id}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) onDone(true);
  };

  const museumShort = visit.museumName.length > 28 ? "this museum" : visit.museumName;

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === dialog.current && onClose()}
      aria-label="Which painting is this?"
      className="m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-ink/60 backdrop:backdrop-blur-sm md:m-auto md:h-[min(52rem,92dvh)] md:w-[min(68rem,94vw)]"
    >
      <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-wall text-ink shadow-hung md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:grid-rows-1 md:rounded-3xl">
        {/* The photo */}
        <div className="flex items-center justify-center bg-surface p-4 md:p-8">
          <img
            src={photo.url ?? ""}
            alt="Your photo"
            className="painting max-h-[28dvh] w-auto max-w-full object-contain md:max-h-full"
          />
        </div>

        {/* Picking the painting */}
        <div className="flex min-h-0 flex-col">
          <div className="flex items-start justify-between gap-4 px-5 pt-5 md:px-7 md:pt-7">
            <div>
              <p className="text-sm tabular-nums text-ink-2">
                Photo {position.index + 1} of {position.total}
              </p>
              <h2 className="font-serif text-2xl leading-tight md:text-3xl">Which painting is this?</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-10 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface hover:text-ink"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          {photo.artwork && (
            <p className="mx-5 mt-3 rounded-xl bg-surface px-4 py-2.5 text-sm md:mx-7">
              Marked as <i className="font-serif text-base">{photo.artwork.title}</i>, {photo.artwork.artistName}.{" "}
              <button type="button" disabled={busy} onClick={() => send({ clear: true }, false)} className="text-ink-2 underline underline-offset-2 hover:text-ink">
                Unmark
              </button>
            </p>
          )}

          {manual ? (
            <form
              className="flex flex-col gap-4 px-5 pt-6 md:px-7"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) send({ title: title.trim(), artist: artist.trim() || undefined });
              }}
            >
              <p className="text-ink-2">
                Not every painting is in our catalogue. Add it by hand and you can still rank it. It just won&apos;t shape
                your taste profile.
              </p>
              <label className="block">
                <span className="text-sm text-ink-2">Title</span>
                <input
                  autoFocus
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="From the wall label"
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-3 outline-none placeholder:text-ink-2/70 focus:border-ink-2"
                />
              </label>
              <label className="block">
                <span className="text-sm text-ink-2">Artist (optional)</span>
                <input
                  maxLength={120}
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-3 outline-none focus:border-ink-2"
                />
              </label>
              <div className="flex items-center gap-2">
                <button type="submit" disabled={busy || !title.trim()} className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-wall disabled:opacity-40">
                  Add painting
                </button>
                <button type="button" onClick={() => setManual(false)} className="rounded-full px-4 py-2.5 text-sm text-ink-2 hover:text-ink">
                  Back to the list
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="px-5 pt-5 md:px-7">
                <label className="block">
                  <span className="sr-only">Search paintings</span>
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search by title or artist"
                    className="w-full rounded-full border border-line bg-surface px-5 py-3 outline-none placeholder:text-ink-2 focus:border-ink-2"
                  />
                </label>
                <div role="tablist" aria-label="Where to look" className="mt-3 flex gap-1 text-sm">
                  {(
                    [
                      ["museum", `At ${museumShort}`],
                      ["all", "All paintings"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      role="tab"
                      type="button"
                      aria-selected={scope === value}
                      onClick={() => setScope(value)}
                      className={`rounded-full px-3 py-1.5 transition-colors ${scope === value ? "bg-ink text-wall" : "text-ink-2 hover:text-ink"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 md:px-5">
                {results === null ? (
                  <p className="px-2 py-6 text-sm text-ink-2">Loading…</p>
                ) : results.length === 0 ? (
                  <p className="px-2 py-6 text-sm text-ink-2">
                    {scope === "all" && !q.trim()
                      ? "Type a title or artist to search every painting we know."
                      : scope === "museum" && !q.trim()
                        ? "We don't have this museum's paintings listed. Search all paintings, or add it by hand."
                        : "No matches. Try the artist's surname, or add it by hand."}
                  </p>
                ) : (
                  <ul>
                    {results.map((c) => {
                      const current = photo.artwork?.id === c.id;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => send({ artworkId: c.id })}
                            className={`flex w-full items-center gap-4 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface ${current ? "bg-surface" : ""}`}
                          >
                            <span className="flex size-14 shrink-0 items-center justify-center">
                              {c.thumbUrl ? (
                                <img src={c.thumbUrl} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                              ) : (
                                <span className="size-12 rounded bg-line" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <i className="block truncate font-serif text-base">{c.title}</i>
                              <span className="block truncate text-sm text-ink-2">
                                {c.artistName}
                                {c.year != null && `, ${c.year}`}
                              </span>
                            </span>
                            {current && <span className="shrink-0 text-xs text-ink-2">Current</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 md:px-7">
            {error ? <p role="alert" className="text-sm text-accent">{error}</p> : (
              !manual && (
                <button type="button" onClick={() => setManual(true)} className="text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                  Not listed? Add it by hand
                </button>
              )
            )}
            <div className="ml-auto flex items-center gap-1">
              <button type="button" disabled={busy} onClick={remove} className="rounded-full px-3 py-2 text-sm text-ink-2 hover:text-accent">
                Remove photo
              </button>
              <button type="button" disabled={busy} onClick={() => onDone(true)} className="rounded-full px-3 py-2 text-sm text-ink-2 hover:text-ink">
                Skip
              </button>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
