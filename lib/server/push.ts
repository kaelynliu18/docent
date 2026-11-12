import "server-only";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import * as webpush from "web-push";
import { z } from "zod";
import type { DB } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { env, features } from "@/lib/env";

export const subscriptionBody = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export async function saveSubscription(db: DB, userId: string, raw: unknown) {
  const sub = subscriptionBody.parse(raw);
  await db
    .insert(s.pushSubscriptions)
    .values({ endpoint: sub.endpoint, userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({ target: s.pushSubscriptions.endpoint, set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
}

export async function removeSubscription(db: DB, userId: string, endpoint: string) {
  await db.delete(s.pushSubscriptions).where(and(eq(s.pushSubscriptions.userId, userId), eq(s.pushSubscriptions.endpoint, endpoint)));
}

/**
 * The day after a visit, nudge people who still have photos to identify or
 * paintings to rank. Each visit is considered once (notified_at), whether or
 * not the user has notifications on, so nobody gets a reminder weeks late.
 */
export async function sendVisitReminders(db: DB, now = new Date()) {
  const cutoff = new Date(now.getTime() - 12 * 3600 * 1000);
  const rows = await db
    .select({
      visitId: s.visits.id,
      userId: s.visits.userId,
      museum: s.museums.name,
      toIdentify: sql<number>`(select count(*)::int from photos p where p.visit_id = ${s.visits.id} and p.artwork_id is null)`,
      toRank: sql<number>`(select count(distinct p.artwork_id)::int from photos p where p.visit_id = ${s.visits.id} and p.artwork_id is not null
        and not exists (select 1 from rankings r where r.user_id = ${s.visits.userId} and r.artwork_id = p.artwork_id)
        and not exists (select 1 from skips k where k.user_id = ${s.visits.userId} and k.artwork_id = p.artwork_id))`,
    })
    .from(s.visits)
    .innerJoin(s.museums, eq(s.museums.id, s.visits.museumId))
    .where(and(isNull(s.visits.notifiedAt), lt(s.visits.createdAt, cutoff)))
    .limit(500);
  if (!rows.length) return { considered: 0, sent: 0 };
  await db.update(s.visits).set({ notifiedAt: now }).where(inArray(s.visits.id, rows.map((r) => r.visitId)));

  const due = rows.filter((r) => r.toIdentify + r.toRank > 0);
  if (!due.length || !features.push()) return { considered: rows.length, sent: 0 };
  const e = env();
  webpush.setVapidDetails(e.VAPID_SUBJECT, e.VAPID_PUBLIC_KEY!, e.VAPID_PRIVATE_KEY!);
  const subs = await db.select().from(s.pushSubscriptions).where(inArray(s.pushSubscriptions.userId, [...new Set(due.map((r) => r.userId))]));

  let sent = 0;
  for (const r of due) {
    const body =
      r.toRank > 0
        ? `${r.toRank} ${r.toRank === 1 ? "painting" : "paintings"} from your visit are waiting to be ranked.`
        : `${r.toIdentify} ${r.toIdentify === 1 ? "photo needs" : "photos need"} identifying.`;
    const payload = JSON.stringify({ title: r.museum, body, url: r.toRank > 0 ? `/rank?visit=${r.visitId}` : `/visits/${r.visitId}` });
    for (const sub of subs.filter((x) => x.userId === r.userId)) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400 });
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.delete(s.pushSubscriptions).where(eq(s.pushSubscriptions.endpoint, sub.endpoint));
      }
    }
  }
  return { considered: rows.length, sent };
}
