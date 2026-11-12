import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { runIngestion } from "@/lib/ingest/run";
import { ApiError, handle } from "@/lib/server/errors";
import { cronAuthorized } from "@/lib/server/cron";

export const maxDuration = 300;

/** Vercel Cron sends GET with the bearer secret; POST works for manual runs. */
const run = handle(async (req: Request) => {
  if (!cronAuthorized(req)) throw new ApiError(401, "unauthorized", "Not allowed.");
  const { runId } = await runIngestion(await getDb());
  return NextResponse.json({ runId });
});

export const GET = run;
export const POST = run;
