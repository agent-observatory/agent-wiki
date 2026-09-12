import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  output: "standalone",
  turbopack: { root: path.resolve(".") },
  outputFileTracingRoot: path.resolve("."),
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination:
          (process.env.INTERNAL_API_URL ?? "http://127.0.0.1:3001") +
          "/api/:path*",
      },
    ];
  },
};
export default config;
