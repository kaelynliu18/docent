import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { ApiError } from "./errors";

/**
 * Sliding-window limit: at most `max` events per `key` in the last `windowSec`.
 * Throws 429 with a human message when exceeded; otherwise records the event.
 */
export async function limit(db: DB, key: string, max: number, windowSec: number, message: string) {
  const since = new Date(Date.now() - windowSec * 1000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.rateEvents)
    .where(and(eq(s.rateEvents.key, key), gt(s.rateEvents.at, since)));
  if (n >= max) throw new ApiError(429, "rate_limited", message);
  await db.insert(s.rateEvents).values({ key });
}

export async function pruneRateEvents(db: DB, olderThanSec = 2 * 86400) {
  await db.delete(s.rateEvents).where(lt(s.rateEvents.at, new Date(Date.now() - olderThanSec * 1000)));
}

/** Best-effort client IP for limits (Vercel/most proxies set x-forwarded-for). */
export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
