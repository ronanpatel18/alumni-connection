import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The app runs on 127.0.0.1 locally (Supabase redirect URLs use it).
  allowedDevOrigins: ["127.0.0.1"],
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
