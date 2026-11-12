import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { env } from "@/lib/env";

/**
 * Photo storage behind one small interface.
 *  - local: files under PHOTO_DIR. Dev and single-server deploys (a VPS, Fly volume, Docker volume).
 *  - s3: any S3-compatible bucket: Cloudflare R2 (10 GB free, no egress fees), Supabase Storage, AWS S3.
 *    The bucket stays private; owners get short-lived signed URLs.
 * Each photo is stored twice: `<key>` (≤2000 px) and its `_t` thumbnail (≤480 px), both made in the browser.
 */
const KEY_RE = /^[0-9a-f]{2}\/[0-9a-f]{32}\.jpg$/;
const thumbOf = (key: string) => key.replace(/\.jpg$/, "_t.jpg");
const variant = (key: string, size: "full" | "thumb") => {
  if (!KEY_RE.test(key)) throw new Error("bad storage key");
  return size === "thumb" ? thumbOf(key) : key;
};

/* ───────── drivers ───────── */

type Driver = {
  put(name: string, bytes: Uint8Array): Promise<void>;
  /** A Response that delivers the file to its (already authorised) owner. */
  serve(name: string): Promise<Response | null>;
  remove(name: string): Promise<void>;
};

const local = (): Driver => {
  const root = path.resolve(env().PHOTO_DIR);
  const file = (name: string) => path.join(root, name);
  return {
    async put(name, bytes) {
      await fs.mkdir(path.dirname(file(name)), { recursive: true });
      await fs.writeFile(file(name), bytes);
    },
    async serve(name) {
      const bytes = await fs.readFile(file(name)).catch(() => null);
      if (!bytes) return null;
      return new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" },
      });
    },
    async remove(name) {
      await fs.rm(file(name), { force: true });
    },
  };
};

const s3 = (): Driver => {
  const e = env();
  const client = new AwsClient({
    accessKeyId: e.S3_ACCESS_KEY_ID!,
    secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
    region: e.S3_REGION,
    service: "s3",
  });
  const url = (name: string) => `${e.S3_ENDPOINT!.replace(/\/$/, "")}/${e.S3_BUCKET}/${name}`;
  return {
    async put(name, bytes) {
      const r = await client.fetch(url(name), {
        method: "PUT",
        body: new Uint8Array(bytes),
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" },
      });
      if (!r.ok) throw new Error(`storage put failed: ${r.status} ${await r.text().catch(() => "")}`);
    },
    async serve(name) {
      // Redirect to a signed URL valid for an hour; the browser caches the redirect for slightly less.
      const signed = await client.sign(`${url(name)}?X-Amz-Expires=3600`, { method: "GET", aws: { signQuery: true } });
      return new Response(null, {
        status: 302,
        headers: { Location: signed.url, "Cache-Control": "private, max-age=3000" },
      });
    },
    async remove(name) {
      const r = await client.fetch(url(name), { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw new Error(`storage delete failed: ${r.status}`);
    },
  };
};

let driver: Driver | null = null;
const store = () => (driver ??= env().STORAGE_DRIVER === "s3" ? s3() : local());

/* ───────── public API ───────── */

/** Stores the full photo and its thumbnail; returns one key for both. */
export async function putPhoto(full: Uint8Array, thumb: Uint8Array): Promise<string> {
  const id = crypto.randomBytes(16).toString("hex");
  const key = `${id.slice(0, 2)}/${id}.jpg`;
  await store().put(key, full);
  await store().put(thumbOf(key), thumb);
  return key;
}

export async function photoResponse(key: string, size: "full" | "thumb" = "full") {
  return store().serve(variant(key, size));
}

export async function deletePhoto(key: string) {
  await Promise.all([store().remove(variant(key, "full")), store().remove(variant(key, "thumb"))]);
}

/** Best effort: storage failures must never block deleting the database rows. */
export async function deletePhotos(keys: string[]) {
  await Promise.allSettled(keys.map(deletePhoto));
}

/** Uploads are re-encoded JPEGs from the browser; reject anything else by magic bytes. */
export function isJpeg(b: Uint8Array) {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
