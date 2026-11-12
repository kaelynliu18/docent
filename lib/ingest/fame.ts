import { userAgent } from "./sparql";

/**
 * Fame = how likely a visitor is to recognise a painting.
 * Sitelinks (Wikipedia languages) measure breadth; English Wikipedia
 * pageviews measure how many people actually look it up. We blend their
 * percentile ranks so neither scale dominates. Pure, tested.
 */
export function computeFame(
  items: { id: string; sitelinks: number }[],
  views: Map<string, number>,
  viewWeight = 0.6,
): Map<string, number> {
  const pct = (vals: Map<string, number>) => {
    const sorted = [...vals.entries()].sort((a, b) => a[1] - b[1]);
    const out = new Map<string, number>();
    const n = sorted.length;
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && sorted[j + 1][1] === sorted[i][1]) j++;
      const r = n === 1 ? 1 : (i + j) / 2 / (n - 1); // ties share the average rank
      for (let k = i; k <= j; k++) out.set(sorted[k][0], r);
      i = j + 1;
    }
    return out;
  };
  const sl = pct(new Map(items.map((x) => [x.id, x.sitelinks])));
  const pv = pct(new Map(items.map((x) => [x.id, views.get(x.id) ?? 0])));
  const out = new Map<string, number>();
  for (const x of items) {
    out.set(x.id, Math.round((viewWeight * (pv.get(x.id) ?? 0) + (1 - viewWeight) * (sl.get(x.id) ?? 0)) * 1000) / 1000);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PvResponse = {
  query?: {
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
    pages?: { title: string; pageviews?: Record<string, number | null> }[];
  };
};

/**
 * Last 60 days of English Wikipedia pageviews per article, 50 titles per
 * request via the MediaWiki API (prop=pageviews, following pvipcontinue). The per-article REST
 * endpoint throttles hard (~73 min for 1,600 titles); this takes seconds.
 * Redirects are followed. Failures count as 0.
 */
export async function fetchPageviews(
  titles: Map<string, string>,
  opts: { batch?: number; log?: (m: string) => void } = {},
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const entries = [...titles.entries()];
  const size = opts.batch ?? 50;
  let failed = 0;
  for (let i = 0; i < entries.length; i += size) {
    const chunk = entries.slice(i, i + size);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "pageviews",
      pvipdays: "60",
      redirects: "1",
      titles: chunk.map(([, t]) => t.replace(/_/g, " ")).join("|"),
    });
    // The API fills in views for ~10 pages per response and returns a
    // pvipcontinue token for the rest, so follow it until the batch is done.
    const views = new Map<string, number>();
    const step = new Map<string, string>();
    let cont: Record<string, string> = {};
    let ok = true;
    for (let page = 0; page < 20; page++) {
      let json: PvResponse & { continue?: Record<string, string> } = {};
      let got = false;
      for (let attempt = 0; attempt < 7 && !got; attempt++) {
        try {
          const r = await fetch(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ ...Object.fromEntries(params), ...cont })}`, {
            headers: { "User-Agent": userAgent() },
            signal: AbortSignal.timeout(30_000),
          });
          if (r.ok) {
            json = await r.json();
            got = true;
          } else {
            // 429: honour Retry-After, else back off exponentially (2, 4, 8… s, max 60).
            const ra = Number(r.headers.get("retry-after"));
            await sleep(Math.min(60_000, (ra > 0 ? ra : 2 ** (attempt + 1)) * 1000));
          }
        } catch {
          await sleep(Math.min(60_000, 2 ** (attempt + 1) * 1000));
        }
      }
      if (!got || !json.query) {
        ok = false;
        break;
      }
      for (const p of json.query.pages ?? []) {
        if (p.pageviews) {
          views.set(p.title, Object.values(p.pageviews).reduce<number>((s, v) => s + (v ?? 0), 0));
        }
      }
      for (const n of json.query.normalized ?? []) step.set(n.from, n.to);
      for (const n of json.query.redirects ?? []) step.set(n.from, n.to);
      if (!json.continue) break;
      cont = json.continue;
      await sleep(400);
    }
    let missing = 0;
    for (const [id, title] of chunk) {
      let t = title.replace(/_/g, " ");
      for (let k = 0; k < 4 && step.has(t); k++) t = step.get(t)!;
      // normalized entries use the raw (underscore) form as "from"
      if (!views.has(t) && step.has(title)) {
        t = step.get(title)!;
        for (let k = 0; k < 4 && step.has(t); k++) t = step.get(t)!;
      }
      if (!views.has(t) && !ok) missing++;
      out.set(id, views.get(t) ?? 0);
    }
    failed += missing;
    await sleep(400);
  }
  if (failed) opts.log?.(`pageviews: ${failed} lookups failed (treated as 0)`);
  return out;
}
