import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The app runs on 127.0.0.1 locally (Supabase redirect URLs use it).
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  poweredByHeader: false,
  // A members-only network: keep every page out of search engines (a noindex
  // meta tag alone isn't privacy; see design/prototypes/HANDOFF.md), and block
  // framing, MIME sniffing and needless referrer details.
  headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // The LinkedIn import sends parsed connections (names, employers, links),
      // read from the export in the browser; ~120 bytes each, up to 30,000.
      bodySizeLimit: "5mb",
    },
  },
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
