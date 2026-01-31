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
      <h1 className="text-2xl font-bold">ブログ</h1>
      <p className="mt-2 text-sm text-zinc-600">
        運営からのお知らせやアップデート情報を掲載します。
      </p>

      <div className="mt-6 space-y-4">
        {posts.length === 0 && (
          <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600">
            記事がまだありません。
          </div>
        )}
        {posts.map((post) => (
          <div key={post.slug} className="rounded-xl border border-zinc-200 p-5">
            <Link
              href={`/blog/${post.slug}`}
              className="text-lg font-semibold hover:underline"
            >
              {post.frontMatter.title ?? post.slug}
            </Link>
            {post.frontMatter.date && (
              <div className="mt-1 text-xs text-zinc-500">
                {post.frontMatter.date}
              </div>
            )}
            {post.frontMatter.description && (
              <p className="mt-2 text-sm text-zinc-600">
                {post.frontMatter.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
