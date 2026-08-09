import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: "20mb",
  },
  serverExternalPackages: ["bullmq", "ioredis", "pg"],
};

export default nextConfig;
