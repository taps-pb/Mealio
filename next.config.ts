import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: { "/api/meals/export": ["./src/server/meals/fonts/*"] },
  async headers() {
    return [{ source: "/nutrition/sw.js", headers: [
      { key: "Service-Worker-Allowed", value: "/nutrition" },
      { key: "Cache-Control", value: "no-cache" },
    ] }];
  },
};

export default nextConfig;
