import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: { "/api/meals/export": ["./src/server/meals/fonts/*"] },
};

export default nextConfig;
