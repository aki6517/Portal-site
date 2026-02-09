import Link from "next/link";
import { getAllBlogPosts } from "@/lib/content";

const SITE_NAME = "福岡アクトポータル";

export async function generateMetadata() {
  return {
    title: `ブログ | ${SITE_NAME}`,
  };
}

export default function BlogPage() {
  const posts = getAllBlogPosts();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="card-retro p-6 md:p-8">
        <span className="badge-retro bg-pop-yellow shadow-hard-sm">
          BLOG
        </span>
        <h1 className="mt-3 font-display text-3xl tracking-tight md:text-4xl">
          演劇ブログ
        </h1>
        <p className="mt-2 text-sm text-zinc-700">
          運営からのお知らせ、アップデート、特集記事を掲載しています。
        </p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {posts.length === 0 && (
          <div className="card-retro p-6 text-sm text-zinc-700">
            記事がまだありません。
          </div>
        )}
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="card-retro block p-5 transition-transform hover:-translate-y-0.5"
          >
            <div className="badge-retro bg-surface shadow-hard-sm text-[11px]">
              {post.frontMatter.date ?? "公開日未設定"}
            </div>
            <h2 className="mt-3 font-display text-xl leading-tight">
              {post.frontMatter.title ?? post.slug}
            </h2>
            <p className="mt-2 text-sm text-zinc-700">
              {post.frontMatter.description ?? "続きを読む"}
            </p>
            <div className="mt-4 text-xs font-black text-pop-pink">
              記事を読む →
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
