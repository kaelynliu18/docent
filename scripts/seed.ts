/** pnpm db:seed — migrate, load fixtures/seed.json, (re)create the demo account. */
import { getDb, migrateDb } from "@/lib/db/client";
import { readSeed, seedArt, seedDemoUser } from "@/lib/db/seed";

async function main() {
  const db = await getDb();
  if (process.env.DATABASE_URL) await migrateDb(db); // PGlite migrates itself on open
  const ds = readSeed();
  const rows = await seedArt(db, ds);
  const demo = await seedDemoUser(db, ds);
  console.log(
    `seeded ${rows} rows: ${ds.artworks.filter((w) => w.inPool).length} pool paintings, ${ds.museums.length} museums. ` +
      `demo account: ${demo.total} rankings (${demo.loved} loved / ${demo.fine} fine / ${demo.meh} meh)`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
