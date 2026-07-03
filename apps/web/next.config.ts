import type { NextConfig } from "next";

const API_URL = process.env.FACILITY_API_URL ?? "http://localhost:4400";

const nextConfig: NextConfig = {
  transpilePackages: ["@facility/ui"],
  async rewrites() {
    // Same-origin proxy to the control plane: session cookies flow without
    // cross-origin ceremony, in dev and behind any reverse proxy in prod.
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
