/**
 * pnpm looks colors [--seed]   measure colour from each pool painting's image (no key needed)
 * pnpm looks moods  [--seed]   tag 1–3 moods per painting with Claude (needs Anthropic credentials)
 *
 * --seed updates fixtures/seed.json (used by tests, the demo and pnpm eval:algo);
 * without it, rows in the database that are still missing a value get filled.
 * Both passes only fill gaps, so re-running is cheap and safe.
 */
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { fetchColorStats, pool, thumbUrls } from "@/lib/ingest/looks";
import { tagMoods } from "@/lib/ingest/moods";
import type { ColorStats } from "@/lib/algo/look";

const [what] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const seed = process.argv.includes("--seed");
if (what !== "colors" && what !== "moods") {
  console.error("usage: pnpm looks colors|moods [--seed]");
  process.exit(1);
}

type Target = { id: string; title: string; imageFile: string };

async function run(
  targets: Target[],
  save: (id: string, v: ColorStats | string[]) => Promise<void> | void,
  checkpoint: () => void = () => {},
) {
  const client = what === "moods" ? new Anthropic() : null;
  const thumbs = client ? new Map<string, string>() : await thumbUrls(targets.map((t) => t.imageFile));
  if (!client) console.log(`thumbnail links for ${thumbs.size}/${targets.length}`);
  let done = 0, missed = 0;
  await pool(targets, what === "moods" ? 4 : 2, async (t) => {
    try {
      const thumb = thumbs.get(t.imageFile);
      const v = client ? await tagMoods(client, t) : thumb ? await fetchColorStats(thumb) : null;
      if (v) await save(t.id, v);
      else missed++;
    } catch (e) {
      missed++;
      if (e instanceof Anthropic.AuthenticationError) throw e;
      if (e instanceof Anthropic.RateLimitError) await new Promise((r) => setTimeout(r, 10_000));
    }
    if (++done % 100 === 0) {
      console.log(`${done}/${targets.length} (${missed} skipped)`);
      checkpoint();
    }
  });
  console.log(`${what}: ${targets.length - missed} filled, ${missed} skipped`);
}

async function main() {
  if (seed) {
    const file = "fixtures/seed.json";
    const ds = JSON.parse(fs.readFileSync(file, "utf8"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<string, any>(ds.artworks.map((w: any) => [w.id, w]));
    const targets: Target[] = ds.artworks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((w: any) => w.inPool && w.imageFile && w[what] == null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((w: any) => ({ id: w.id, title: w.title, imageFile: w.imageFile }));
    const write = () => {
      // Every artwork carries both keys so the seed writer knows to set them.
      for (const w of ds.artworks) {
        w.colors ??= null;
        w.moods ??= null;
      }
      fs.writeFileSync(file, JSON.stringify(ds));
    };
    // Saves every 100 paintings, so an interrupted run keeps its progress.
    await run(targets, (id, v) => void (byId.get(id)[what] = v), write);
    write();
  } else {
    const { getDb } = await import("@/lib/db/client");
    const s = await import("@/lib/db/schema");
    const db = await getDb();
    const col = what === "colors" ? s.artworks.colors : s.artworks.moods;
    const targets = await db
      .select({ id: s.artworks.id, title: s.artworks.title, imageFile: s.artworks.imageFile })
      .from(s.artworks)
      .where(and(eq(s.artworks.inPool, true), isNotNull(s.artworks.imageFile), isNull(col)));
    await run(targets as Target[], async (id, v) => {
      await db.update(s.artworks).set(what === "colors" ? { colors: v as ColorStats } : { moods: v as string[] }).where(eq(s.artworks.id, id));
    });
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
