import crypto from "node:crypto";
import { cookies } from "next/headers";
import { features } from "@/lib/env";
import { googleAuthUrl } from "@/lib/server/auth";
import { appOrigin } from "@/lib/server/origin";
import { ApiError, handle } from "@/lib/server/errors";

export const GET = handle(async (req: Request) => {
  if (!features.google()) throw new ApiError(503, "google_off", "Google sign-in isn't set up on this server.");
  const state = crypto.randomBytes(16).toString("base64url");
  (await cookies()).set("docent_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return Response.redirect(googleAuthUrl(`${appOrigin(req)}/api/auth/google/callback`, state), 302);
});
