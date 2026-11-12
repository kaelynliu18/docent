/**
 * Full three-pass ingestion into the configured database.
 * Local: writes to PGlite. Production: DATABASE_URL=postgres://… pnpm ingest
 * Stop `pnpm dev` first when using PGlite (it allows one process at a time).
 */
import { getDb } from "@/lib/db/client";
import { runIngestion } from "@/lib/ingest/run";

async function main() {
  const { runId, rows } = await runIngestion(await getDb(), { log: (m) => console.log(m) });
  console.log(`ingest run ${runId}: ${rows} rows upserted`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
