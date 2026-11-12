import { NextResponse } from "next/server";
import { setSessionUser } from "@/lib/server/session";
import { DEMO_USER_ID } from "@/lib/db/demo";
import { handle } from "@/lib/server/errors";

/** Switch this browser to the pre-seeded demo account (for live demos). */
export const POST = handle(async () => {
  await setSessionUser(DEMO_USER_ID);
  return NextResponse.json({ ok: true });
});
