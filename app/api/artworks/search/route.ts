import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { searchArtworks } from "@/lib/server/visits";
import { handle } from "@/lib/server/errors";

/** GET ?q= → catalogue paintings by title or artist. */
export const GET = handle(async (req: Request) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json(await searchArtworks(await getDb(), q.slice(0, 100)));
});
