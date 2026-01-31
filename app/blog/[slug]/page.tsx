import { notFound } from "next/navigation";
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
      <h1 className="text-2xl font-bold">
        {post.frontMatter.title ?? post.slug}
      </h1>
      {post.frontMatter.date && (
        <div className="mt-2 text-xs text-zinc-500">
          {post.frontMatter.date}
        </div>
      )}
      {post.frontMatter.description && (
        <p className="mt-3 text-sm text-zinc-600">
          {post.frontMatter.description}
        </p>
      )}
      <article
        className="prose prose-zinc mt-6 max-w-none"
        dangerouslySetInnerHTML={{ __html: post.html }}
      />
    </div>
  );
}
