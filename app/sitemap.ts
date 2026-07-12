import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo";
import { getCategories, getSitemapEvents } from "@/lib/data/events";
import { getAllBlogPosts } from "@/lib/content";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const [categories, events] = await Promise.all([
    getCategories(),
    getSitemapEvents(),
  ]);
  const blogPosts = getAllBlogPosts();

  // 静的ページ（末尾スラなしに統一。canonical=lib/seo.tsのbuildMetadataと一致させる）
  const staticEntries: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "daily", priority: 1.0 },
    { url: `${siteUrl}/events`, changeFrequency: "daily", priority: 0.9 },
    { url: `${siteUrl}/calendar`, changeFrequency: "daily", priority: 0.7 },
    { url: `${siteUrl}/blog`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${siteUrl}/events/archive`, changeFrequency: "weekly", priority: 0.4 },
    { url: `${siteUrl}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${siteUrl}/contact`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${siteUrl}/privacy-policy`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const categoryEntries: MetadataRoute.Sitemap = categories.map((category) => ({
    url: `${siteUrl}/events/${encodeURIComponent(category.id)}`,
    changeFrequency: "daily",
    priority: 0.6,
  }));

  // published＋公開日到来＋shouldNoindexでない公演のみ（終演+7日超は除外）
  const eventEntries: MetadataRoute.Sitemap = events.map((event) => ({
    url: `${siteUrl}/events/${encodeURIComponent(event.category)}/${encodeURIComponent(
      event.slug
    )}`,
    lastModified: event.updated_at ?? undefined,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const blogEntries: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${siteUrl}/blog/${encodeURIComponent(post.slug)}`,
    lastModified: post.frontMatter.date ?? undefined,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...staticEntries, ...categoryEntries, ...eventEntries, ...blogEntries];
}
