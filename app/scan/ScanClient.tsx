"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { embedPhoto, scanModelCached } from "@/lib/client/clip";

type Match = { id: string; title: string; year: number | null; artistName: string; thumbUrl: string | null; similarity: number };
type State =
  | { kind: "idle" }
  | { kind: "working"; progress: number | null; preview: string }
  | { kind: "done"; preview: string; matches: Match[]; notFound: boolean; ms: number }
  | { kind: "error"; preview: string | null };

/**
 * Scan a painting: snap or pick a photo, match it on this device against the
 * catalogue, confirm one of the closest. The photo is processed in memory and
 * never uploaded; only its 512-number embedding goes to the server.
 */
export function ScanClient() {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Match[] | null>(null);

  const scan = async (file: File) => {
    const preview = URL.createObjectURL(file);
    setFound(null);
    setState({ kind: "working", progress: scanModelCached() ? null : 0, preview });
    try {
      const t0 = performance.now();
      const vector = await embedPhoto(file, { onProgress: (p) => setState({ kind: "working", progress: p, preview }) });
      const r = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vector }) });
      if (!r.ok) throw new Error();
      const j = (await r.json()) as { matches: Match[]; notFound: boolean };
      setState({ kind: "done", preview, matches: j.matches, notFound: j.notFound, ms: Math.round(performance.now() - t0) });
    } catch {
      setState({ kind: "error", preview });
    }
  };

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch(`/api/artworks/search?q=${encodeURIComponent(q)}`);
    setFound(r.ok ? await r.json() : []);
  };

  const preview = state.kind === "idle" ? null : state.preview;

  return (
    <section className="mx-auto max-w-2xl py-6">
      <h1 className="font-serif text-4xl">Scan a painting</h1>
      <p className="mt-2 text-ink-2">Take a photo of a painting and we&apos;ll find it in the catalogue. The photo stays on your phone.</p>

      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void scan(f);
        }}
      />
      <button type="button" onClick={() => input.current?.click()} className="mt-6 rounded-full bg-ink px-6 py-3 font-medium text-wall">
        {state.kind === "idle" ? "Take or choose a photo" : "Scan another"}
      </button>
      {!scanModelCached() && state.kind === "idle" && <p className="mt-2 text-xs text-ink-2">The first scan downloads the matcher (about 90 MB) once.</p>}

      {preview && (
        <div className="mt-8 grid gap-6 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <img src={preview} alt="Your photo" className="max-h-64 w-full rounded-xl object-contain sm:w-48" />
          <div>
            {state.kind === "working" && (
              <p role="status" className="text-ink-2">
                {state.progress != null && state.progress < 1 ? `Getting the matcher ready… ${Math.round(state.progress * 100)}%` : "Looking…"}
              </p>
            )}
            {state.kind === "error" && <p className="text-ink-2">Couldn&apos;t read that photo. Try another.</p>}
            {state.kind === "done" && (
              <>
                <p className="text-sm font-semibold tracking-wide text-ink-2 uppercase">{state.notFound ? "Not sure. Is it one of these?" : "Best matches"}</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {state.matches.map((m) => (
                    <li key={m.id}>
                      <Link href={`/artwork/${m.id}`} className="flex items-center gap-4 rounded-xl px-2 py-2 hover:bg-surface">
                        <img src={m.thumbUrl ?? ""} alt="" loading="lazy" className="size-14 rounded object-contain" />
                        <span className="min-w-0 flex-1">
                          <i className="block truncate font-serif text-base">{m.title}</i>
                          <span className="block truncate text-sm text-ink-2">
                            {m.artistName}
                            {m.year != null && `, ${m.year}`}
                          </span>
                        </span>
                        <span className="text-xs tabular-nums text-ink-2">{Math.round(m.similarity * 100)}%</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-2">Matched in {(state.ms / 1000).toFixed(1)} s.</p>
              </>
            )}
          </div>
        </div>
      )}

      {state.kind === "done" && (
        <form onSubmit={search} className="mt-8">
          <p className="text-sm text-ink-2">{state.notFound ? "It may not be in our catalogue. Search by title or artist:" : "Not there? Search by title or artist:"}</p>
          <div className="mt-2 flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="From the wall label" className="min-w-0 flex-1 rounded-full border border-line bg-surface px-5 py-3 outline-none focus:border-ink-2" />
            <button type="submit" disabled={q.trim().length < 2} className="rounded-full border border-line px-5 py-3 text-sm disabled:opacity-40">
              Search
            </button>
          </div>
          {found && (
            <ul className="mt-3 flex flex-col gap-1">
              {found.length === 0 && <li className="text-sm text-ink-2">Nothing found.</li>}
              {found.map((m) => (
                <li key={m.id}>
                  <Link href={`/artwork/${m.id}`} className="flex items-center gap-4 rounded-xl px-2 py-2 hover:bg-surface">
                    <img src={m.thumbUrl ?? ""} alt="" loading="lazy" className="size-12 rounded object-contain" />
                    <span className="min-w-0">
                      <i className="block truncate font-serif">{m.title}</i>
                      <span className="block truncate text-sm text-ink-2">{m.artistName}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
    </section>
  );
}
