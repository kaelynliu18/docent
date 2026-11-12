import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { colorStats, type ColorStats } from "@/lib/algo/look";

const UA = "Docent/1.0 (art ranking app; colour analysis)";

/** Decodes a small JPEG or PNG into pixels. Null for any other format. */
export function decodeImage(bytes: Uint8Array, contentType: string | null): { px: Uint8Array; channels: 3 | 4 } | null {
  const isPng = contentType?.includes("png") || (bytes[0] === 0x89 && bytes[1] === 0x50);
  const isJpeg = contentType?.includes("jpeg") || (bytes[0] === 0xff && bytes[1] === 0xd8);
  if (isJpeg) {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 });
    return { px: img.data, channels: 4 };
  }
  if (isPng) {
    const img = PNG.sync.read(Buffer.from(bytes));
    return { px: img.data, channels: 4 };
  }
  return null;
}

/**
 * Standard-size (120px) thumbnail URLs for up to 50 Commons files per request.
 * Odd sizes (?width=96) make Commons render on demand and get throttled hard;
 * standard sizes are already cached.
 */
export async function thumbUrls(files: string[], width = 120): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&iiurlwidth=${width}&titles=${encodeURIComponent(batch.map((f) => `File:${f}`).join("|"))}`;
    const res = await politeFetch(url);
    if (!res?.ok) continue;
    const j = (await res.json()) as {
      query?: { normalized?: { from: string; to: string }[]; pages?: Record<string, { title: string; imageinfo?: { thumburl?: string }[] }> };
    };
    const back = new Map((j.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of Object.values(j.query?.pages ?? {})) {
      const thumb = p.imageinfo?.[0]?.thumburl;
      const asked = (back.get(p.title) ?? p.title).replace(/^File:/, "");
      if (thumb) out.set(asked, thumb);
    }
  }
  return out;
}

/** GET with backoff on 429/503 (Commons throttles bursts). Null after 6 tries. */
async function politeFetch(url: string, signal?: AbortSignal): Promise<Response | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal });
    if (res.status !== 429 && res.status !== 503) return res;
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  return null;
}

/** Fetches a thumbnail and measures its colour. Null if it can't be read. */
export async function fetchColorStats(thumbUrl: string, signal?: AbortSignal): Promise<ColorStats | null> {
  const res = await politeFetch(thumbUrl, signal);
  if (!res?.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const img = decodeImage(bytes, res.headers.get("content-type"));
  if (!img) return null;
  const s = colorStats(img.px, img.channels);
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { warmth: round(s.warmth), brightness: round(s.brightness), saturation: round(s.saturation), contrast: round(s.contrast) };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function pool<T>(items: T[], limit: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}
