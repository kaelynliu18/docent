/** pnpm db:migrate — apply pending migrations to DATABASE_URL (or the local PGlite). Runs on every Vercel deploy. */
import { getDb, migrateDb } from "@/lib/db/client";

async function main() {
  const db = await getDb();
  await migrateDb(db);
  console.log(`migrations applied (${process.env.DATABASE_URL ? "postgres" : "pglite"})`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
