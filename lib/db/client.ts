import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * DATABASE_URL=postgres://… → real Postgres (Supabase/Neon) via postgres-js.
 * Otherwise → embedded PGlite at PGLITE_DIR (default .data/pglite), for local dev.
 * Both expose the same Drizzle API, so the rest of the app is typed against one.
 */
export type DB = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __docentDb?: Promise<DB> };

async function create(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const postgres = (await import("postgres")).default;
    // Serverless: one connection per instance, through the provider's pooler (Supabase :6543, Neon -pooler).
    // prepare:false because transaction-mode poolers don't support prepared statements.
    const client = postgres(url, {
      max: process.env.VERCEL ? 1 : Number(process.env.DB_POOL_MAX ?? 5),
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    return drizzlePg(client, { schema });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  if (dir !== "memory") (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzle(client, { schema }) as unknown as DB;
  if (process.env.PGLITE_AUTO_MIGRATE !== "0") await migrateDb(db);
  return db;
}

export async function migrateDb(db: DB) {
  const url = process.env.DATABASE_URL;
  const folder = process.env.MIGRATIONS_DIR ?? "lib/db/migrations";
  if (url && /^postgres/.test(url)) {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db, { migrationsFolder: folder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: folder });
  }
}

export function getDb(): Promise<DB> {
  if (!g.__docentDb) g.__docentDb = create();
  return g.__docentDb;
}

/** Test helper: replace the singleton (e.g. with an in-memory PGlite). */
export function setDbForTests(db: Promise<DB>) {
  g.__docentDb = db;
}

export { schema };
