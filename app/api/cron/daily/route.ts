import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { sendVisitReminders } from "@/lib/server/push";
import { pruneExpired, pruneIdleGuests } from "@/lib/server/maintenance";
import { cronAuthorized } from "@/lib/server/cron";
import { ApiError, handle } from "@/lib/server/errors";

export const maxDuration = 60;

/** Daily: visit reminders, prune idle guests and expired codes. (The demo account is personal now; reset it with pnpm db:seed.) */
const run = handle(async (req: Request) => {
  if (!cronAuthorized(req)) throw new ApiError(401, "unauthorized", "Not allowed.");
  const db = await getDb();
  const reminders = await sendVisitReminders(db);
  const guests = await pruneIdleGuests(db);
  await pruneExpired(db);
  return NextResponse.json({ reminders, prunedGuests: guests });
});

export const GET = run;
export const POST = run;
