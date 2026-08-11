import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: "32mb",
  },
  serverExternalPackages: ["bullmq", "ioredis", "pg"],
};

export default nextConfig;
