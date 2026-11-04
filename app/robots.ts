import type { MetadataRoute } from "next";

/** A private, members-only network: nothing here is for search engines. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
