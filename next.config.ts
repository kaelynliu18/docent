import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/large packages stay out of the server bundle (embedding runs in scripts, never in a request).
  serverExternalPackages: ["@electric-sql/pglite", "@huggingface/transformers", "onnxruntime-node", "sharp"],
  webpack: (config, { isServer }) => {
    // The browser build of transformers.js (photo scan) must not pull in its Node-only backends.
    if (!isServer) config.resolve.alias = { ...config.resolve.alias, sharp$: false, "onnxruntime-node$": false };
    return config;
  },
};

export default nextConfig;
