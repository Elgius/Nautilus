import type { NextConfig } from "next";
import path from "node:path";

const monorepoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    // Keep browser cookies on the web origin; only the server knows the API host.
    const apiOrigin = process.env.API_ORIGIN || "http://localhost:8787";
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  turbopack: {
    root: monorepoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
