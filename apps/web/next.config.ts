import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const API_URL = process.env.FACILITY_API_URL ?? "http://localhost:4400";
const DEV_ORIGINS = (process.env.FACILITY_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const nextConfig: NextConfig = {
  output: "standalone",
  // Serving development through a tunnel or a LAN host: Next blocks
  // cross-origin dev requests (HMR websocket, RSC fetches) unless the origin
  // is allow-listed. Comma-separated hostnames, no scheme.
  allowedDevOrigins: DEV_ORIGINS,
  // Monorepo: tell Turbopack and the standalone tracer where the root is.
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ["@facility/ui"],
  async rewrites() {
    // Same-origin proxy to the control plane: session cookies flow without
    // cross-origin ceremony, in dev and behind any reverse proxy in prod.
    return [
      { source: "/api/:path*", destination: `${API_URL}/:path*` },
      { source: "/preview/:path*", destination: `${API_URL}/preview/:path*` },
    ];
  },
};

export default nextConfig;
