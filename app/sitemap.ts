import type { MetadataRoute } from "next";

export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://fukuoka-stage.com";

  return [
    { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1.0 },
    { url: `${siteUrl}/events/`, changeFrequency: "daily", priority: 0.9 },
    { url: `${siteUrl}/blog/`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${siteUrl}/calendar/`, changeFrequency: "daily", priority: 0.7 },
    { url: `${siteUrl}/about/`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/contact/`, changeFrequency: "yearly", priority: 0.4 },
    {
      url: `${siteUrl}/privacy-policy/`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}

