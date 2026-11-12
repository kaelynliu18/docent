import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { currentUserId, requireUserId } from "@/lib/server/session";
import { deleteVisit, getVisit } from "@/lib/server/visits";
import { deletePhotos } from "@/lib/server/storage";
import { ApiError, handle } from "@/lib/server/errors";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const v = await getVisit(await getDb(), await currentUserId(), (await ctx.params).id);
  if (!v) throw new ApiError(404, "not_found", "We couldn't find that visit.");
  return NextResponse.json(v);
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const keys = await deleteVisit(await getDb(), await requireUserId(), (await ctx.params).id);
  await deletePhotos(keys);
  return new Response(null, { status: 204 });
});
