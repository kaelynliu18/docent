import crypto from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { DEMO_USER_ID } from "@/lib/db/demo";
import { env } from "@/lib/env";
import { ApiError } from "./errors";
import { limit } from "./rate";
import { mergeGuestInto } from "./data";

/**
 * Accounts. Guests are users with no email; signing in either upgrades the
 * current guest in place (first sign-in) or merges the guest into an existing
 * account. Email sign-in uses a 6-digit code rather than a link because an
 * installed iOS web app doesn't share cookies with Safari, where links open.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "invalid email");

const hashCode = (email: string, code: string) =>
  crypto.createHmac("sha256", env().AUTH_SECRET ?? "dev-only-secret-change-me").update(`${email}:${code}`).digest("hex");

export async function startEmailSignIn(db: DB, rawEmail: unknown, ip: string) {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) throw new ApiError(400, "bad_email", "That doesn't look like an email address.");
  const email = parsed.data;
  await limit(db, `code:email:${email}`, 5, 3600, "Too many codes for this email. Try again in an hour.");
  await limit(db, `code:ip:${ip}`, 20, 3600, "Too many sign-in attempts. Try again in an hour.");

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.update(s.loginCodes).set({ usedAt: new Date() }).where(and(eq(s.loginCodes.email, email), isNull(s.loginCodes.usedAt)));
  await db.insert(s.loginCodes).values({ email, codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  return { email, code };
}

export async function verifyEmailCode(db: DB, rawEmail: unknown, rawCode: unknown) {
  const email = emailSchema.parse(rawEmail);
  const code = z.string().trim().regex(/^\d{6}$/).safeParse(rawCode);
  if (!code.success) throw new ApiError(400, "bad_code", "Enter the 6-digit code from the email.");
  const [row] = await db
    .select()
    .from(s.loginCodes)
    .where(and(eq(s.loginCodes.email, email), isNull(s.loginCodes.usedAt), gt(s.loginCodes.expiresAt, new Date())))
    .orderBy(desc(s.loginCodes.createdAt))
    .limit(1);
  if (!row) throw new ApiError(400, "code_expired", "That code has expired. Send a new one.");
  if (row.attempts >= MAX_ATTEMPTS) throw new ApiError(429, "too_many_attempts", "Too many wrong codes. Send a new one.");
  const want = Buffer.from(row.codeHash, "hex");
  const got = Buffer.from(hashCode(email, code.data), "hex");
  if (!crypto.timingSafeEqual(want, got)) {
    await db.update(s.loginCodes).set({ attempts: row.attempts + 1 }).where(eq(s.loginCodes.id, row.id));
    throw new ApiError(400, "wrong_code", "That code isn't right. Check the email and try again.");
  }
  await db.update(s.loginCodes).set({ usedAt: new Date() }).where(eq(s.loginCodes.id, row.id));
  return email;
}

/**
 * Resolve a verified identity to a user, carrying over whatever the current
 * guest has done. Returns the user id to put in the session.
 */
export async function signIn(db: DB, who: { email: string; googleSub?: string }, currentUserId: string | null) {
  const email = who.email.toLowerCase();
  const [byGoogle] = who.googleSub ? await db.select().from(s.users).where(eq(s.users.googleSub, who.googleSub)) : [];
  const [byEmail] = byGoogle ? [] : await db.select().from(s.users).where(eq(s.users.email, email));
  const existing = byGoogle ?? byEmail;

  const [current] = currentUserId ? await db.select().from(s.users).where(eq(s.users.id, currentUserId)) : [];
  const currentIsGuest = !!current && !current.email && !current.googleSub && current.id !== DEMO_USER_ID;

  if (existing) {
    if (who.googleSub && !existing.googleSub) await db.update(s.users).set({ googleSub: who.googleSub }).where(eq(s.users.id, existing.id));
    if (currentIsGuest && current.id !== existing.id) await mergeGuestInto(db, current.id, existing.id);
    return existing.id;
  }
  if (currentIsGuest) {
    await db.update(s.users).set({ email, googleSub: who.googleSub ?? null }).where(eq(s.users.id, current.id));
    return current.id;
  }
  const [u] = await db.insert(s.users).values({ email, googleSub: who.googleSub ?? null }).returning({ id: s.users.id });
  return u.id;
}

/** Deletes the account and everything in it. Returns photo storage keys for the caller to remove. */
export async function deleteAccount(db: DB, userId: string) {
  if (userId === DEMO_USER_ID) throw new ApiError(403, "demo", "The demo account can't be deleted.");
  const photos = await db.select({ key: s.photos.storageKey }).from(s.photos).where(eq(s.photos.userId, userId));
  await db.delete(s.users).where(eq(s.users.id, userId));
  return photos.map((p) => p.key).filter((k): k is string => !!k);
}

export async function getAccount(db: DB, userId: string | null) {
  if (!userId) return null;
  const [u] = await db.select({ id: s.users.id, email: s.users.email, google: s.users.googleSub }).from(s.users).where(eq(s.users.id, userId));
  if (!u) return null;
  return { id: u.id, email: u.email, hasGoogle: !!u.google, isDemo: u.id === DEMO_USER_ID, isGuest: !u.email && u.id !== DEMO_USER_ID };
}

/* ───────── Google (OAuth 2 authorization code, no SDK) ───────── */

export function googleAuthUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function googleIdentity(code: string, redirectUri: string) {
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env().GOOGLE_CLIENT_ID!,
      client_secret: env().GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tok.ok) throw new ApiError(400, "google_failed", "Google sign-in didn't complete. Try again.");
  const { access_token } = (await tok.json()) as { access_token: string };
  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const u = (await info.json()) as { sub?: string; email?: string; email_verified?: boolean };
  if (!info.ok || !u.sub || !u.email || !u.email_verified) {
    throw new ApiError(400, "google_failed", "Google didn't share a verified email. Try email sign-in instead.");
  }
  return { googleSub: u.sub, email: u.email };
}

