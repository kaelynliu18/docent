import { NextResponse } from "next/server";
import { clearSession } from "@/lib/server/session";
import { handle } from "@/lib/server/errors";

export const POST = handle(async () => {
  await clearSession();
  return NextResponse.json({ ok: true });
});
