import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { seedDemoUser } from "@/lib/db/seed";
import { sendVisitReminders } from "@/lib/server/push";
import { pruneExpired, pruneIdleGuests } from "@/lib/server/maintenance";
import { cronAuthorized } from "@/lib/server/cron";
import { ApiError, handle } from "@/lib/server/errors";

export const maxDuration = 60;

/** Daily: visit reminders, reset the shared demo account, prune idle guests and expired codes. */
const run = handle(async (req: Request) => {
  if (!cronAuthorized(req)) throw new ApiError(401, "unauthorized", "Not allowed.");
  const db = await getDb();
  const reminders = await sendVisitReminders(db);
  await seedDemoUser(db);
  const guests = await pruneIdleGuests(db);
  await pruneExpired(db);
  return NextResponse.json({ reminders, prunedGuests: guests });
});

export const GET = run;
export const POST = run;
