import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@ai-film-studio/contracts",
    "@ai-film-studio/book-engine",
  ],
};

export default nextConfig;
