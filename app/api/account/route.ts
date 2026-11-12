import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { deleteAccount, getAccount } from "@/lib/server/auth";
import { setPrefs } from "@/lib/server/data";
import { clearSession, currentUserId, requireUserId } from "@/lib/server/session";
import { deletePhotos } from "@/lib/server/storage";
import { ApiError, handle } from "@/lib/server/errors";

export const GET = handle(async () => NextResponse.json(await getAccount(await getDb(), await currentUserId())));

/** Preferences: { hideNudity: boolean }. Guests can set them too. */
export const PATCH = handle(async (req: Request) =>
  NextResponse.json(await setPrefs(await getDb(), await requireUserId(), await req.json())),
);

/** Permanently delete the signed-in user's account, visits, photos and rankings (required by app stores). */
export const DELETE = handle(async () => {
  const userId = await currentUserId();
  if (!userId) throw new ApiError(401, "signed_out", "You're not signed in.");
  const keys = await deleteAccount(await getDb(), userId);
  await clearSession();
  await deletePhotos(keys);
  return new Response(null, { status: 204 });
});
