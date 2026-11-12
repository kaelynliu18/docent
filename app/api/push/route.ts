import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { env, features } from "@/lib/env";
import { requireUserId } from "@/lib/server/session";
import { removeSubscription, saveSubscription } from "@/lib/server/push";
import { ApiError, handle } from "@/lib/server/errors";

export const GET = handle(async () =>
  NextResponse.json({ enabled: features.push(), publicKey: features.push() ? env().VAPID_PUBLIC_KEY : null }),
);

export const POST = handle(async (req: Request) => {
  if (!features.push()) throw new ApiError(503, "push_off", "Notifications aren't set up on this server.");
  const userId = await requireUserId();
  await saveSubscription(await getDb(), userId, await req.json());
  return new Response(null, { status: 204 });
});

export const DELETE = handle(async (req: Request) => {
  const { endpoint } = z.object({ endpoint: z.string().url() }).parse(await req.json());
  await removeSubscription(await getDb(), await requireUserId(), endpoint);
  return new Response(null, { status: 204 });
});
