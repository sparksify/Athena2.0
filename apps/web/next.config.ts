import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@athena/db", "@athena/core", "@athena/contracts"],
};

export default nextConfig;
