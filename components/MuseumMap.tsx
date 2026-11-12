"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export type Pin = { id: string; name: string; lat: number; lon: number; pct?: number };

function Fit({ pins, origin }: { pins: Pin[]; origin?: { lat: number; lon: number } | null }) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = pins.map((p) => [p.lat, p.lon]);
    if (origin) pts.push([origin.lat, origin.lon]);
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
  }, [map, pins, origin]);
  return null;
}

/** OSM tiles, softened with CSS to a light (or inverted dark) style; pins sized by match. */
export default function MuseumMap({
  pins,
  origin,
  height = 420,
}: {
  pins: Pin[];
  origin?: { lat: number; lon: number } | null;
  height?: number;
}) {
  const router = useRouter();
  const dark = typeof document !== "undefined" && getComputedStyle(document.documentElement).colorScheme === "dark";
  const accent = typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7a2e1f" : "#7a2e1f";
  return (
    <div className="overflow-hidden rounded-2xl border border-line" style={{ height }}>
      <MapContainer center={[30, 0]} zoom={2} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className={dark ? "tiles-dark" : "tiles-light"}
        />
        {origin && (
          <CircleMarker center={[origin.lat, origin.lon]} radius={5} pathOptions={{ color: "#2563eb", fillOpacity: 1 }}>
            <Tooltip>You</Tooltip>
          </CircleMarker>
        )}
        {pins.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={p.pct != null ? 5 + (p.pct / 100) * 13 : 9}
            pathOptions={{ color: accent, fillColor: accent, fillOpacity: 0.55, weight: 1.5 }}
            eventHandlers={{ click: () => router.push(`/museums/${p.id}`) }}
          >
            <Tooltip>
              {p.name}
              {p.pct != null && ` · ${p.pct}% match`}
            </Tooltip>
          </CircleMarker>
        ))}
        <Fit pins={pins} origin={origin} />
      </MapContainer>
    </div>
  );
}
