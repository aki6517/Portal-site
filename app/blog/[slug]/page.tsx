import { notFound } from "next/navigation";
import Link from "next/link";
import { getBlogPostBySlug } from "@/lib/content";

const SITE_NAME = "福岡アクトポータル";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}) {
  const post = getBlogPostBySlug(params.slug);
  if (!post) {
    return {
      title: `ブログ | ${SITE_NAME}`,
    };
  }
  return {
    title: `${post.frontMatter.title ?? "ブログ"} | ${SITE_NAME}`,
    description: post.frontMatter.description ?? undefined,
  };
}

export default function BlogDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const post = getBlogPostBySlug(params.slug);
  if (!post) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/blog" className="badge-retro bg-surface shadow-hard-sm">
        ← ブログ一覧に戻る
      </Link>

      <div className="card-retro mt-4 p-6 md:p-8">
        <div className="badge-retro bg-pop-blue text-white shadow-hard-sm text-[11px]">
          {post.frontMatter.date ?? "公開日未設定"}
        </div>
        <h1 className="mt-3 font-display text-3xl leading-tight tracking-tight md:text-4xl">
          {post.frontMatter.title ?? post.slug}
        </h1>
        {post.frontMatter.description && (
          <p className="mt-3 text-sm text-zinc-700">
            {post.frontMatter.description}
          </p>
        )}
      </div>

      <article
        className="prose prose-zinc mt-6 max-w-none rounded-2xl border-2 border-ink bg-surface p-6 shadow-hard md:p-8"
        dangerouslySetInnerHTML={{ __html: post.html }}
      />
    </div>
  );
}
