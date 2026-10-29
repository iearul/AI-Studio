import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@ai-studio/contracts", "@ai-studio/book-engine"],
};

export default nextConfig;
