import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { env, features } from "@/lib/env";
import { startEmailSignIn } from "@/lib/server/auth";
import { sendEmail } from "@/lib/server/email";
import { clientIp } from "@/lib/server/rate";
import { ApiError, handle } from "@/lib/server/errors";

export const POST = handle(async (req: Request) => {
  if (!features.email()) throw new ApiError(503, "email_off", "Email sign-in isn't set up on this server.");
  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  const { email, code } = await startEmailSignIn(await getDb(), body.email, clientIp(req));
  await sendEmail(
    email,
    `${code} is your Docent code`,
    `Your Docent sign-in code is ${code}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
    `<div style="font-family:Georgia,serif;max-width:420px;margin:auto;padding:24px;color:#1f1d1a">
      <p style="font-size:15px">Your Docent sign-in code:</p>
      <p style="font-size:36px;letter-spacing:8px;margin:16px 0"><b>${code}</b></p>
      <p style="font-size:13px;color:#57524b">It expires in 10 minutes. If you didn't ask for it, ignore this email.</p>
    </div>`,
  );
  // Without an email provider in dev, hand the code back so the flow is testable.
  const dev = env().NODE_ENV !== "production" && !env().RESEND_API_KEY;
  return NextResponse.json({ sent: true, ...(dev ? { devCode: code } : {}) });
});
