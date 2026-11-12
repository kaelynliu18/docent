import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db/client";
import { googleIdentity, signIn } from "@/lib/server/auth";
import { currentUserId, setSessionUser } from "@/lib/server/session";
import { appOrigin } from "@/lib/server/origin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = appOrigin(req);
  const jar = await cookies();
  const want = jar.get("docent_oauth_state")?.value ?? "";
  jar.delete("docent_oauth_state");
  const got = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const ok = want.length > 0 && want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got));
  if (!ok || !code) return Response.redirect(`${origin}/account?error=google`, 302);
  try {
    const who = await googleIdentity(code, `${origin}/api/auth/google/callback`);
    const db = await getDb();
    await setSessionUser(await signIn(db, who, await currentUserId()));
    return Response.redirect(`${origin}/account?signed=1`, 302);
  } catch {
    return Response.redirect(`${origin}/account?error=google`, 302);
  }
}
