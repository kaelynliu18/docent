"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { MuseumMatch } from "@/lib/server/data";
import { CITIES } from "@/lib/cities";
import { ScoreBadge } from "@/components/ScoreBadge";

const MuseumMap = dynamic(() => import("@/components/MuseumMap"), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-2xl border border-line bg-surface" />,
});

type Result = { locked: null | { rankedCount: number; needed: number; reason: string }; matches: MuseumMatch[] };
type Loc = { kind: "anywhere" } | { kind: "point"; label: string; lat: number; lon: number };

const RADII = [25, 100, 300, 1000];

export function MuseumsClient({ initial }: { initial: Result }) {
  const [loc, setLoc] = useState<Loc>({ kind: "anywhere" });
  const [radius, setRadius] = useState(300);
  const [includeVisited, setIncludeVisited] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [geoError, setGeoError] = useState<string | null>(null);

  // Remember the last location on this device only.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("docent-loc");
      if (saved) setLoc(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("docent-loc", JSON.stringify(loc));
    } catch {}
  }, [loc]);

  const params = new URLSearchParams();
  if (loc.kind === "point") {
    params.set("lat", loc.lat.toFixed(3));
    params.set("lon", loc.lon.toFixed(3));
    params.set("radiusKm", String(radius));
  }
  if (includeVisited) params.set("includeVisited", "true");
  const qs = params.toString();

  const { data, isFetching } = useQuery<Result>({
    queryKey: ["museums", qs],
    queryFn: async () => (await fetch(`/api/recommendations/museums?${qs}`, { cache: "no-store" })).json(),
    initialData: qs === "" ? initial : undefined,
    placeholderData: keepPreviousData,
  });
  const res = data ?? initial;

  const requestMyLocation = () => {
    setGeoError(null);
    if (!navigator.geolocation) return setGeoError("Your browser can't share a location. Pick a city instead.");
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ kind: "point", label: "Near you", lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setGeoError("We couldn't get your location. Pick a city instead."),
      { timeout: 8000, maximumAge: 600_000 },
    );
  };

  if (res.locked) {
    const pct = Math.min(100, (res.locked.rankedCount / 5) * 100);
    return (
      <section className="mx-auto max-w-md py-24 text-center">
        <h1 className="font-serif text-4xl">Your next museum</h1>
        <p className="mt-3 text-ink-2">{res.locked.reason}</p>
        <div className="mx-auto mt-6 h-2 w-56 overflow-hidden rounded-full bg-line" aria-hidden>
          <div className="h-full rounded-full bg-loved" style={{ width: `${pct}%` }} />
        </div>
        <Link href="/rank" className="mt-8 inline-block rounded-full bg-ink px-6 py-3 text-wall">
          Keep ranking
        </Link>
      </section>
    );
  }

  const origin = loc.kind === "point" ? { lat: loc.lat, lon: loc.lon } : null;
  const pins = res.matches
    .filter((m) => m.museum.lat != null && m.museum.lon != null)
    .map((m) => ({ id: m.museum.id, name: m.museum.name, lat: m.museum.lat!, lon: m.museum.lon!, pct: m.matchPct }));

  return (
    <section className="py-4">
      <h1 className="font-serif text-4xl">Your next museum</h1>
      <p className="mt-1 text-ink-2">Ranked by how much of what you love hangs there.</p>

      <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <label className="sr-only" htmlFor="loc">
          Location
        </label>
        <select
          id="loc"
          value={loc.kind === "anywhere" ? "anywhere" : loc.label}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "anywhere") return setLoc({ kind: "anywhere" });
            if (v === "__me") return requestMyLocation();
            const c = CITIES.find((x) => x.name === v);
            if (c) setLoc({ kind: "point", label: c.name, lat: c.lat, lon: c.lon });
          }}
          className="rounded-full border border-line bg-surface px-3 py-2"
        >
          <option value="anywhere">Anywhere in the world</option>
          <option value="__me">Use my location</option>
          {loc.kind === "point" && !CITIES.some((c) => c.name === loc.label) && <option value={loc.label}>{loc.label}</option>}
          <optgroup label="Cities">
            {CITIES.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>
        {loc.kind === "point" && (
          <>
            <label className="sr-only" htmlFor="radius">
              Distance
            </label>
            <select
              id="radius"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="rounded-full border border-line bg-surface px-3 py-2"
            >
              {RADII.map((r) => (
                <option key={r} value={r}>
                  within {r} km
                </option>
              ))}
            </select>
          </>
        )}
        <label className="flex items-center gap-2 rounded-full px-3 py-2 text-ink-2">
          <input type="checkbox" checked={includeVisited} onChange={(e) => setIncludeVisited(e.target.checked)} className="accent-[var(--accent)]" />
          Include places I&apos;ve been
        </label>
        <div className="ml-auto flex rounded-full border border-line bg-surface p-0.5" role="tablist" aria-label="View">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1.5 capitalize ${view === v ? "bg-ink text-wall" : "text-ink-2"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {geoError && <p className="mt-2 text-sm text-accent">{geoError}</p>}

      <div className={`mt-6 transition-opacity ${isFetching ? "opacity-60" : ""}`}>
        {res.matches.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface p-8 text-center text-ink-2">
            Nothing that matches your taste within {radius} km. Try a wider distance or “Anywhere”.
          </p>
        ) : view === "map" ? (
          <MuseumMap pins={pins} origin={origin} height={520} />
        ) : (
          <ol className="flex flex-col gap-4">
            {res.matches.map((m, i) => (
              <MuseumCard key={m.museum.id} m={m} rank={i + 1} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function MuseumCard({ m, rank }: { m: MuseumMatch; rank: number }) {
  const where = [m.museum.city, m.museum.country].filter(Boolean).join(", ");
  return (
    <li className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <span className="mt-1 w-6 text-right font-serif text-xl text-ink-2">{rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Link href={`/museums/${m.museum.id}`} className="font-serif text-2xl leading-tight hover:underline">
              {m.museum.name}
            </Link>
            <span className="text-sm font-semibold tabular-nums text-loved">{m.matchPct}% match</span>
          </div>
          <p className="text-sm text-ink-2">
            {where}
            {m.distanceKm != null && ` · ${m.distanceKm.toLocaleString()} km away`}
          </p>
          {m.reasons.length > 0 && <p className="mt-2 text-sm">Holds {joinList(m.reasons)}.</p>}
          {m.topWorks.length > 0 && (
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {m.topWorks.map((w) => (
                <li key={w.id}>
                  <Link href={`/artwork/${w.id}`} className="flex items-center gap-3 rounded-xl p-1 hover:bg-wall">
                    <img src={w.thumbUrl ?? ""} alt={`${w.title} by ${w.artistName}`} loading="lazy" className="size-14 shrink-0 rounded object-cover" />
                    <span className="min-w-0 flex-1">
                      <i className="block truncate font-serif">{w.title}</i>
                      <span className="block truncate text-xs text-ink-2">{w.artistName}</span>
                    </span>
                    <ScoreBadge score={w.predicted} predicted lowConfidence={w.confidence === "low"} size="sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

function joinList(xs: string[]) {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}
