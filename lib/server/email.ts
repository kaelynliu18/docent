import "server-only";
import { env } from "@/lib/env";

/** Send through Resend's HTTP API (free tier: 3,000/month). In dev without a key, print to the server log. */
export async function sendEmail(to: string, subject: string, text: string, html: string) {
  const e = env();
  if (!e.RESEND_API_KEY) {
    if (e.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set");
    console.log(`\n[email to ${to}] ${subject}\n${text}\n`);
    return;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: e.EMAIL_FROM, to, subject, text, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`email send failed: ${r.status} ${await r.text().catch(() => "")}`);
}
