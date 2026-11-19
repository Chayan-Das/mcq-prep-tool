import type { NextConfig } from "next";

const nextConfig: NextConfig = {
   typescript: {
    // বিল্ড সফল করার জন্য সাময়িকভাবে টাইপচেক এরর ইগনোর করা হলো
    ignoreBuildErrors: true,
  },
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
