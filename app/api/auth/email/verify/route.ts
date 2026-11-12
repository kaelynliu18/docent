import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { signIn, verifyEmailCode } from "@/lib/server/auth";
import { currentUserId, setSessionUser } from "@/lib/server/session";
import { clientIp, limit } from "@/lib/server/rate";
import { handle } from "@/lib/server/errors";

export const POST = handle(async (req: Request) => {
  const db = await getDb();
  await limit(db, `verify:ip:${clientIp(req)}`, 30, 3600, "Too many attempts. Try again in an hour.");
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; code?: unknown };
  const email = await verifyEmailCode(db, body.email, body.code);
  const userId = await signIn(db, { email }, await currentUserId());
  await setSessionUser(userId);
  return NextResponse.json({ ok: true });
});
