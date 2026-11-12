import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { currentUserId, requireUserId } from "@/lib/server/session";
import { createVisit, getVisits } from "@/lib/server/visits";
import { handle } from "@/lib/server/errors";

export const GET = handle(async () => NextResponse.json(await getVisits(await getDb(), await currentUserId())));

export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  const v = await createVisit(await getDb(), userId, await req.json());
  return NextResponse.json({ id: v.id, reused: v.reused }, { status: v.reused ? 200 : 201 });
});
