/**
 * pnpm eval:scan — photo-to-artwork recognition.
 *
 * Synthetic: a seeded sample of catalogue paintings, each distorted the ways a
 * phone photo differs (lib/algo/distort.ts), embedded with the same CLIP model
 * and searched against the full image index. Top-1 / top-5, with and without
 * a centre crop, over the whole catalogue and within the painting's museum
 * (what the app does during a visit). Latency per query (embed + search).
 * Not-found threshold: distorted photos of paintings removed from the index
 * vs. ones present; picks the cut-off with the best balanced accuracy.
 * Real: any photos in eval/photos/<Wikidata id>.jpg (e.g. Q12418.jpg); photos
 * of paintings not in the catalogue go in eval/photos/not-in-catalogue/.
 * Writes the "scan" section of docs/eval-results.md. Needs `pnpm embed` first.
 */
import fs from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { EMBEDDING, RECS, SCAN } from "@/lib/algo/config";
import { indexesFromRows, topK } from "@/lib/algo/vectors";
import { DISTORTIONS, centerCrop, type Img } from "@/lib/algo/distort";
import { mulberry32 } from "@/lib/algo/evaluate";
import { PNG } from "pngjs";
import { politeFetch, thumbUrls } from "@/lib/ingest/looks";
import { embedRgba } from "@/lib/ingest/embed";
import { writeEvalSection } from "@/lib/evalReport";

const N = Number(process.env.SCAN_EVAL_N ?? 150);
const NEG = Math.round(N / 3);
const CROP = SCAN.crop;

function toImg(bytes: Uint8Array): Img | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const j = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { data: new Uint8ClampedArray(j.data), width: j.width, height: j.height };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const p = PNG.sync.read(Buffer.from(bytes));
    return { data: new Uint8ClampedArray(p.data), width: p.width, height: p.height };
  }
  return null;
}

async function main() {
  const db = await getDb();
  const rows = await db
    .select({ id: s.artworkEmbeddings.artworkId, kind: s.artworkEmbeddings.kind, vector: s.artworkEmbeddings.vector })
    .from(s.artworkEmbeddings)
    .where(and(eq(s.artworkEmbeddings.kind, "image"), eq(s.artworkEmbeddings.model, EMBEDDING.model), eq(s.artworkEmbeddings.version, EMBEDDING.version), isNotNull(s.artworkEmbeddings.vector)));
  const { image } = indexesFromRows(rows.map((r) => ({ ...r, vector: r.vector! })), EMBEDDING.dims, RECS.imageWeight);
  const works = await db.select({ id: s.artworks.id, imageFile: s.artworks.imageFile, museumId: s.artworks.museumId, inPool: s.artworks.inPool }).from(s.artworks);
  const museumOf = new Map(works.map((w) => [w.id, w.museumId]));
  const byMuseum = new Map<string, Set<string>>();
  for (const w of works) if (w.museumId) byMuseum.set(w.museumId, (byMuseum.get(w.museumId) ?? new Set()).add(w.id));

  // Seeded sample of embedded pool paintings; the last NEG are "not in the catalogue" (removed from search).
  const rnd = mulberry32(21);
  const pool = works.filter((w) => w.inPool && image.pos.has(w.id) && w.imageFile);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const sampleSet = pool.slice(0, N + NEG);
  const removed = new Set(sampleSet.slice(N).map((w) => w.id));
  const keep = (id: string) => !removed.has(id);
  const thumbs = await thumbUrls(sampleSet.map((w) => w.imageFile!), 500);

  const names = Object.keys(DISTORTIONS);
  type Cell = { t1: number; t5: number; mt1: number; mt5: number; n: number };
  const res: Record<string, Record<"plain" | "crop", Cell>> = Object.fromEntries(
    names.map((n) => [n, { plain: { t1: 0, t5: 0, mt1: 0, mt5: 0, n: 0 }, crop: { t1: 0, t5: 0, mt1: 0, mt5: 0, n: 0 } }]),
  );
  // Not-found signals, measured the way the app runs (centre crop on): best score and top-1 − top-2 margin.
  const pos: number[] = [], neg: number[] = [], posM: number[] = [], negM: number[] = [];
  const timings: number[] = [];
  let done = 0;
  for (const w of sampleSet) {
    const url = thumbs.get(w.imageFile!);
    const r = url ? await politeFetch(url) : null;
    if (!r?.ok) continue;
    const img = toImg(new Uint8Array(await r.arrayBuffer()));
    if (!img) continue;
    const isNeg = removed.has(w.id);
    for (const name of names) {
      if (isNeg && name !== "realistic (frame, wall, tilt, dim, glare)") continue;
      const d = DISTORTIONS[name](img);
      for (const variant of ["plain", "crop"] as const) {
        const q = variant === "crop" ? centerCrop(d, CROP) : d;
        const t0 = performance.now();
        const v = await embedRgba(q.data, q.width, q.height);
        const hits = topK(image, v, 5, { keep });
        timings.push(performance.now() - t0);
        if (isNeg) {
          if (variant === "crop") {
            neg.push(hits[0]?.score ?? 0);
            negM.push((hits[0]?.score ?? 0) - (hits[1]?.score ?? 0));
          }
          continue;
        }
        const ids = hits.map((h) => h.id);
        const museum = museumOf.get(w.id);
        const local = museum ? topK(image, v, 5, { keep: (id) => keep(id) && byMuseum.get(museum)!.has(id) }).map((h) => h.id) : ids;
        const c = res[name][variant];
        c.n++;
        if (ids[0] === w.id) c.t1++;
        if (ids.includes(w.id)) c.t5++;
        if (local[0] === w.id) c.mt1++;
        if (local.includes(w.id)) c.mt5++;
        if (variant === "crop" && name === "realistic (frame, wall, tilt, dim, glare)") {
          pos.push(hits[0]?.score ?? 0);
          posM.push((hits[0]?.score ?? 0) - (hits[1]?.score ?? 0));
        }
      }
    }
    if (++done % 25 === 0) console.log(`${done}/${sampleSet.length}`);
  }

  timings.sort((a, b) => a - b);
  const p50 = timings[Math.floor(timings.length / 2)] ?? 0;
  const p95 = timings[Math.floor(timings.length * 0.95)] ?? 0;

  // Real photos.
  const realDir = "eval/photos";
  const real: { file: string; id: string | null; t1: boolean; t5: boolean; top: number; gap: number }[] = [];
  if (fs.existsSync(realDir)) {
    const files = [
      ...fs.readdirSync(realDir).filter((f) => /\.(jpe?g)$/i.test(f)).map((f) => ({ f: path.join(realDir, f), id: f.replace(/\..*$/, "") })),
      ...(fs.existsSync(`${realDir}/not-in-catalogue`) ? fs.readdirSync(`${realDir}/not-in-catalogue`).filter((f) => /\.(jpe?g)$/i.test(f)).map((f) => ({ f: path.join(realDir, "not-in-catalogue", f), id: null })) : []),
    ];
    for (const { f, id } of files) {
      const j = jpeg.decode(fs.readFileSync(f), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
      let img: Img = { data: new Uint8ClampedArray(j.data), width: j.width, height: j.height };
      // Downscale big phone photos for speed (CLIP sees 224px anyway).
      const step = Math.max(1, Math.floor(Math.max(img.width, img.height) / 800));
      if (step > 1) {
        const w = Math.floor(img.width / step), h = Math.floor(img.height / step);
        const d = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(img.data.subarray(((y * step) * img.width + x * step) * 4, ((y * step) * img.width + x * step) * 4 + 4), (y * w + x) * 4);
        img = { data: d, width: w, height: h };
      }
      const q = centerCrop(img, CROP);
      const v = await embedRgba(q.data, q.width, q.height);
      const hits = topK(image, v, 5);
      real.push({ file: path.basename(f), id, t1: hits[0]?.id === id, t5: hits.some((h) => h.id === id), top: hits[0]?.score ?? 0, gap: (hits[0]?.score ?? 0) - (hits[1]?.score ?? 0) });
    }
  }

  // Confidence rule (as in pickMatches): found if top ≥ S or catalogue-wide gap ≥ M.
  // Grid over (S, M) for the best balanced accuracy; real not-in-catalogue photos count as negatives.
  const negs = [...neg.map((t, i) => ({ t, g: negM[i] })), ...real.filter((r) => !r.id).map((r) => ({ t: r.top, g: r.gap }))];
  const poss = pos.map((t, i) => ({ t, g: posM[i] }));
  const rate = (S: number, M: number) => {
    const found = (x: { t: number; g: number }) => x.t >= S || x.g >= M;
    const tpr = poss.filter(found).length / (poss.length || 1);
    const tnr = negs.filter((x) => !found(x)).length / (negs.length || 1);
    return { tpr, tnr, acc: (tpr + tnr) / 2 };
  };
  let best = { S: SCAN.foundScore, M: SCAN.foundGap, ...rate(SCAN.foundScore, SCAN.foundGap) };
  for (let S = 0.8; S <= 1.0001; S += 0.01)
    for (let M = 0; M <= 0.12; M += 0.002) {
      const r = rate(S, M);
      if (r.acc > best.acc + 1e-9 || (Math.abs(r.acc - best.acc) < 1e-9 && r.tnr > best.tnr)) best = { S: Math.round(S * 100) / 100, M: Math.round(M * 1000) / 1000, ...r };
    }
  const cur = rate(SCAN.foundScore, SCAN.foundGap);
  const scoreOnly = (() => { let b = 0; for (let S = 0.5; S <= 1; S += 0.01) b = Math.max(b, rate(S, 9).acc); return b; })();
  const gapOnly = (() => { let b = 0; for (let M = 0; M <= 0.12; M += 0.002) b = Math.max(b, rate(9, M).acc); return b; })();
  const pct = (a: number, n: number) => (n ? `${((a / n) * 100).toFixed(0)}%` : "–");
  let md = `## Photo recognition\n\nModel ${EMBEDDING.model} (${EMBEDDING.version}), exact cosine search over ${image.ids.length} catalogue images. Command: \`pnpm eval:scan\` (SCAN_EVAL_N=${N}).\n\n### Synthetic photos\n\n${N} catalogue paintings (seeded sample), each distorted as below. "Catalogue" searches all ${image.ids.length} paintings; "museum" searches only the painting's museum, which is what the app does during a visit. Centre crop keeps the middle ${CROP * 100}% of each side.\n\n| Distortion | Catalogue top-1 | top-5 | + centre crop top-1 | top-5 | Museum top-1 | top-5 | + centre crop top-1 | top-5 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const name of names) {
    const a = res[name].plain, b = res[name].crop;
    md += `| ${name} | ${pct(a.t1, a.n)} | ${pct(a.t5, a.n)} | ${pct(b.t1, b.n)} | ${pct(b.t5, b.n)} | ${pct(a.mt1, a.n)} | ${pct(a.mt5, a.n)} | ${pct(b.mt1, b.n)} | ${pct(b.mt5, b.n)} |\n`;
  }
  md += `\n**Not found.** ${poss.length} realistic photos (centre crop on, as in the app) of catalogued paintings vs ${negs.length} of paintings that aren't in the index (${neg.length} synthetic + ${negs.length - neg.length} real). Rule: a match counts as found if its catalogue-wide score ≥ S or it leads the runner-up by ≥ M. Best balanced accuracy: score alone ${(scoreOnly * 100).toFixed(0)}%, gap alone ${(gapOnly * 100).toFixed(0)}%, both: **${(best.acc * 100).toFixed(0)}%** at S = ${best.S}, M = ${best.M}. The app uses S = ${SCAN.foundScore}, M = ${SCAN.foundGap}: ${(cur.tpr * 100).toFixed(0)}% of catalogued paintings are shown as found, ${(cur.tnr * 100).toFixed(0)}% of missing ones are flagged "not a confident match". Paintings look alike to CLIP, so this stays imperfect; the app always asks you to confirm from the top ${SCAN.show}.\n\n**Latency** (Node, CPU, embed + search, per query): median ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms. In the app the embedding runs in the browser (WebAssembly), and the Scan page shows the measured time.\n\n**Not tried:** rectangle detection and local-feature re-ranking (ORB/SIFT). The spec makes both conditional on measured gains; the table shows where the remaining errors are, so they're the next experiments if real photos warrant it.\n`;
  md += `\n### Real photos\n\n`;
  if (real.length) {
    const inCat = real.filter((r) => r.id);
    md += `${inCat.length} photos of catalogued paintings: top-1 **${pct(inCat.filter((r) => r.t1).length, inCat.length)}**, top-5 **${pct(inCat.filter((r) => r.t5).length, inCat.length)}** (centre crop on).\n\n| Photo | Top-1 correct | In top 5 | Best similarity | Margin | App says |\n|---|---|---|---:|---:|---|\n`;
    for (const r of real) md += `| ${r.file}${r.id ? "" : " (not in catalogue)"} | ${r.id ? (r.t1 ? "yes" : "no") : "–"} | ${r.id ? (r.t5 ? "yes" : "no") : "–"} | ${r.top.toFixed(3)} | ${r.gap.toFixed(3)} | ${r.top >= SCAN.foundScore || r.gap >= SCAN.foundGap ? "found" : "not a confident match"} |\n`;
  } else md += `**Pending: needs real photos.** Put photos of catalogue paintings in \`eval/photos/<Wikidata id>.jpg\` and re-run.\n`;
  writeEvalSection("scan", md);
  console.log(md);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
