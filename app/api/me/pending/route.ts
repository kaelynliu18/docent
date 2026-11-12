import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { pendingArtworkIds } from "@/lib/server/visits";
import { handle } from "@/lib/server/errors";

/** Badge count for the Rank tab. */
export const GET = handle(async () => {
  const ids = await pendingArtworkIds(await getDb(), await currentUserId());
  return NextResponse.json({ toRank: ids.length });
});
