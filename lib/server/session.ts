import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

/**
 * Identity comes only from a signed cookie, never from request bodies.
 * Guests get a user row on their first write; signing in later re-points the
 * cookie at the account and merges the guest's rankings (see mergeGuestInto).
 */
const COOKIE = "docent_uid";
const MAX_AGE = 60 * 60 * 24 * 365;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is required in production");
  return s ?? "dev-only-secret-change-me";
}

function sign(id: string) {
  return crypto.createHmac("sha256", secret()).update(id).digest("base64url");
}

export function encodeSession(id: string) {
  return `${id}.${sign(id)}`;
}

export function decodeSession(v: string | undefined): string | null {
  if (!v) return null;
  const i = v.lastIndexOf(".");
  if (i < 0) return null;
  const id = v.slice(0, i);
  const mac = v.slice(i + 1);
  const expected = sign(id);
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

export async function currentUserId(): Promise<string | null> {
  const jar = await cookies();
  return decodeSession(jar.get(COOKIE)?.value);
}

/** For write routes: returns the user, creating a guest if there is none. */
export async function requireUserId(): Promise<string> {
  const existing = await currentUserId();
  const db = await getDb();
  if (existing) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, existing));
    if (u) return u.id;
  }
  const [u] = await db.insert(users).values({}).returning({ id: users.id });
  await setSessionUser(u.id);
  return u.id;
}

export async function setSessionUser(id: string) {
  const jar = await cookies();
  jar.set(COOKIE, encodeSession(id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
