import { env } from "@/lib/env";

/** Public origin for redirects and links: APP_URL if set, else the request's own origin. */
export function appOrigin(req: Request) {
  const fixed = env().APP_URL;
  if (fixed) return fixed.replace(/\/$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
