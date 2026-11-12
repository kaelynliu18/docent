import { and, isNull, lt, ne, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { DEMO_USER_ID } from "@/lib/db/demo";
import { pruneRateEvents } from "./rate";

/** Guests who never logged a visit or ranked anything, 30+ days on. Returns how many were removed. */
export async function pruneIdleGuests(db: DB, now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86400 * 1000);
  const gone = await db
    .delete(s.users)
    .where(
      and(
        isNull(s.users.email),
        isNull(s.users.googleSub),
        ne(s.users.id, DEMO_USER_ID),
        lt(s.users.createdAt, cutoff),
        sql`not exists (select 1 from visits v where v.user_id = ${s.users.id})`,
        sql`not exists (select 1 from rankings r where r.user_id = ${s.users.id})`,
      ),
    )
    .returning({ id: s.users.id });
  return gone.length;
}

export async function pruneExpired(db: DB) {
  await pruneRateEvents(db);
  await db.delete(s.loginCodes).where(lt(s.loginCodes.expiresAt, new Date(Date.now() - 86400 * 1000)));
}
