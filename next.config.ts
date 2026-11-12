import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // The daily cron re-seeds the demo account from this file; make sure it ships with the function.
  outputFileTracingIncludes: { "/api/cron/daily": ["./fixtures/seed.json"] },
};

export default nextConfig;
