/**
 * Group photos into likely visits: same calendar day and within ~1 km of each
 * other. Pure (no I/O) so it runs in the browser and is unit-tested.
 * Photos without GPS join their day's only located group, or form a
 * "somewhere" group for that day; photos without a date group by place.
 */
export type PhotoMeta = { id: string; day: string | null; lat: number | null; lon: number | null };
export type PhotoGroup = { day: string | null; lat: number | null; lon: number | null; ids: string[] };

const R = 6371;
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function groupPhotos(photos: PhotoMeta[], radiusKm = 1): PhotoGroup[] {
  const byDay = new Map<string, PhotoMeta[]>();
  for (const p of photos) {
    const k = p.day ?? "";
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  const out: PhotoGroup[] = [];
  for (const [dayKey, ps] of byDay) {
    const day = dayKey || null;
    const located: (PhotoGroup & { n: number })[] = [];
    const unplaced: string[] = [];
    for (const p of ps) {
      if (p.lat == null || p.lon == null) {
        unplaced.push(p.id);
        continue;
      }
      const g = located.find((c) => distanceKm({ lat: c.lat!, lon: c.lon! }, { lat: p.lat!, lon: p.lon! }) <= radiusKm);
      if (g) {
        // running centroid
        g.lat = (g.lat! * g.n + p.lat) / (g.n + 1);
        g.lon = (g.lon! * g.n + p.lon) / (g.n + 1);
        g.n++;
        g.ids.push(p.id);
      } else located.push({ day, lat: p.lat, lon: p.lon, ids: [p.id], n: 1 });
    }
    if (unplaced.length && located.length === 1 && day) located[0].ids.push(...unplaced);
    else if (unplaced.length) out.push({ day, lat: null, lon: null, ids: unplaced });
    out.push(...located.map(({ day, lat, lon, ids }) => ({ day, lat, lon, ids })));
  }
  // Newest day first; undated last.
  return out.sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "") || b.ids.length - a.ids.length);
}

/** A Date's calendar day in local time, as YYYY-MM-DD. */
export function localDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
