"use client";

import { useEffect, useRef, useState } from "react";

export type PickerMuseum = {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  works?: number;
  distanceKm?: number | null;
};

/** Search museums by name or city, or sort by distance from here. */
export function MuseumPicker({ initial, onPick, autoFocus = true }: { initial?: PickerMuseum[]; onPick: (m: PickerMuseum) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [near, setNear] = useState<{ lat: number; lon: number } | null>(null);
  const [results, setResults] = useState<PickerMuseum[] | null>(initial ?? null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    if (!q.trim() && !near && initial) {
      setResults(initial);
      return;
    }
    const t = window.setTimeout(async () => {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (near) {
        p.set("lat", String(near.lat));
        p.set("lon", String(near.lon));
      }
      const r = await fetch(`/api/museums/search?${p}`).catch(() => null);
      if (id === reqId.current) setResults(r?.ok ? await r.json() : []);
    }, q ? 160 : 0);
    return () => window.clearTimeout(t);
  }, [q, near, initial]);

  const locate = () => {
    if (!navigator.geolocation) return setError("Your browser can't share its location. Search by name instead.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNear({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocating(false);
        setError(null);
      },
      () => {
        setLocating(false);
        setError("We couldn't get your location. Search by name instead.");
      },
      { timeout: 8000, maximumAge: 600_000 },
    );
  };

  return (
    <div>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">Search museums</span>
          <input
            autoFocus={autoFocus}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by museum or city"
            enterKeyHint="search"
            className="w-full rounded-full border border-line bg-surface px-5 py-3 text-base outline-none placeholder:text-ink-2 focus:border-ink-2"
          />
        </label>
        <button
          type="button"
          onClick={near ? () => setNear(null) : locate}
          aria-pressed={!!near}
          className={`shrink-0 rounded-full border px-4 py-3 text-sm transition-colors ${near ? "border-ink bg-ink text-wall" : "border-line bg-surface hover:border-ink-2"}`}
        >
          {locating ? "Locating…" : "Near me"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-accent">{error}</p>}
      <p className="mt-4 text-sm text-ink-2">{q.trim() ? "Matches" : near ? "Closest to you" : "Popular museums"}</p>
      {results === null ? (
        <p className="mt-3 text-sm text-ink-2">Loading…</p>
      ) : results.length === 0 ? (
        <p className="mt-3 text-ink-2">No museums match “{q}”. Try the city name.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line border-y border-line">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onPick(m)}
                className="flex w-full items-center justify-between gap-4 px-1 py-3.5 text-left transition-colors hover:bg-surface active:bg-surface"
              >
                <span className="min-w-0">
                  <span className="block truncate font-serif text-lg">{m.name}</span>
                  <span className="block truncate text-sm text-ink-2">
                    {[m.city, m.country].filter(Boolean).join(", ")}
                    {m.distanceKm != null && ` · ${m.distanceKm < 1 ? "<1" : m.distanceKm.toLocaleString()} km`}
                  </span>
                </span>
                {m.works != null && (
                  <span className="shrink-0 text-xs tabular-nums text-ink-2">
                    {m.works > 0 ? `${m.works.toLocaleString()} paintings` : "No paintings listed"}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
