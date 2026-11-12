import { z } from "zod";

/**
 * Every setting the app reads, validated once. In production a missing
 * required value fails at startup with a list of what to set, instead of a
 * confusing error on some later request.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL").optional(),
  AUTH_SECRET: z.string().min(32, "at least 32 characters (openssl rand -base64 32)").optional(),
  CRON_SECRET: z.string().min(16).optional(),
  /** Public origin, e.g. https://docent.example.com. Used in emails and OAuth redirects. */
  APP_URL: z.string().url().optional(),

  // Photos: local disk by default; any S3-compatible store (Cloudflare R2, Supabase Storage, AWS S3) in production.
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  PHOTO_DIR: z.string().default(".data/photos"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Email sign-in codes via Resend (free tier). Without a key, codes are printed to the server log in dev.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Docent <onboarding@resend.dev>"),

  // Google sign-in (optional).
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Web push (optional): pnpm vapid prints a key pair.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const env = schema.parse(process.env);
  if (env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const missing: string[] = [];
    if (!env.AUTH_SECRET) missing.push("AUTH_SECRET");
    if (process.env.VERCEL && !env.DATABASE_URL) missing.push("DATABASE_URL (Vercel has no persistent disk for PGlite)");
    if (process.env.VERCEL && env.STORAGE_DRIVER === "local") missing.push("STORAGE_DRIVER=s3 (Vercel has no persistent disk for photos)");
    if (env.STORAGE_DRIVER === "s3") {
      for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) if (!env[k]) missing.push(k);
    }
    if (missing.length) throw new Error(`Docent is missing production settings: ${missing.join(", ")}. See .env.example.`);
  }
  return env;
}

let cached: Env | null = null;
export function env(): Env {
  return (cached ??= load());
}

export const features = {
  email: () => !!env().RESEND_API_KEY || env().NODE_ENV !== "production",
  google: () => !!env().GOOGLE_CLIENT_ID && !!env().GOOGLE_CLIENT_SECRET,
  push: () => !!env().VAPID_PUBLIC_KEY && !!env().VAPID_PRIVATE_KEY,
};
