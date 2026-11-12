import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { requireUserId } from "@/lib/server/session";
import { matchPhoto } from "@/lib/server/visits";
import { handle } from "@/lib/server/errors";

/** POST { vector: number[512], museumId? } → closest catalogue paintings. Only the vector is sent, never the photo. */
export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  return NextResponse.json(await matchPhoto(await getDb(), userId, await req.json()));
});
