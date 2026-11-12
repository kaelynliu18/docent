import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { currentUserId, requireUserId } from "@/lib/server/session";
import { getTierForSearch, insertRanking } from "@/lib/server/data";
import { handle } from "@/lib/server/errors";

export const GET = handle(async (req: Request) => {
  const tier = z.enum(["loved", "fine", "meh"]).parse(new URL(req.url).searchParams.get("tier"));
  return NextResponse.json(await getTierForSearch(await getDb(), await currentUserId(), tier));
});

export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  const result = await insertRanking(await getDb(), userId, await req.json());
  return NextResponse.json(result, { status: 201 });
});
