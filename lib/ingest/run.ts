import type { DB } from "@/lib/db/client";
import { ingestRuns } from "@/lib/db/schema";
import { createSparqlClient } from "./sparql";
import { fetchDataset, type FetchOptions } from "./fetch";
import { logRun, writeDataset } from "./write";

/**
 * Fetch everything first (no DB writes), then write in one transaction.
 * Each pass is also recorded in ingest_runs with its row count and timing.
 */
export async function runIngestion(db: DB, opts: FetchOptions = {}) {
  const sparql = createSparqlClient();
  const { runId, result } = await logRun(db, "full", async () => {
    const ds = await fetchDataset(sparql, {
      ...opts,
      onPass: async (p) => {
        const started = new Date(Date.now() - p.ms);
        await db.insert(ingestRuns).values({ pass: p.pass, startedAt: started, finishedAt: new Date(), rowsUpserted: p.rows });
      },
    });
    const rows = await writeDataset(db, ds);
    return { result: rows, rows };
  });
  return { runId, rows: result };
}
