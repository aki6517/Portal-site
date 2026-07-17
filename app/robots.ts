import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://fukuoka-stage.com";
  const privatePaths = ["/admin/", "/theater/", "/register/", "/api/"];

  return {
    rules: [
      {
        userAgent: "GPTBot",
        allow: "/",
        disallow: ["/calendar", ...privatePaths],
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: privatePaths,
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
