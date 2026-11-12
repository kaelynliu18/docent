import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { currentUserId, requireUserId } from "@/lib/server/session";
import { getPhotoKey, identifyPhoto, removePhoto } from "@/lib/server/visits";
import { deletePhoto, photoResponse } from "@/lib/server/storage";
import { ApiError, handle } from "@/lib/server/errors";

type Ctx = { params: Promise<{ id: string }> };

/** Photos are private: served only to their owner. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const key = await getPhotoKey(await getDb(), await currentUserId(), (await ctx.params).id);
  const size = new URL(req.url).searchParams.get("size") === "thumb" ? "thumb" : "full";
  const res = key ? await photoResponse(key, size) : null;
  if (!res) throw new ApiError(404, "not_found", "We couldn't find that photo.");
  return res;
});

/** Say which painting it shows: {artworkId} | {title, artist?} | {clear: true}. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const r = await identifyPhoto(await getDb(), await requireUserId(), (await ctx.params).id, await req.json());
  return NextResponse.json(r);
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const key = await removePhoto(await getDb(), await requireUserId(), (await ctx.params).id);
  if (key) await deletePhoto(key);
  return new Response(null, { status: 204 });
});
