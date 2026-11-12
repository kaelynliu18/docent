import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname, "server-only": `${import.meta.dirname}/tests/stubs/server-only.ts` } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 30000,
    // Each integration file loads the full seed into its own in-memory Postgres; running them one at a time is faster than contending.
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
