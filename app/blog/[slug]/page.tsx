import { notFound } from "next/navigation";
import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { getAllBlogPosts, getBlogPostBySlug } from "@/lib/content";
import { buildMetadata, getSiteUrl } from "@/lib/seo";

const decodeRouteParam = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const toAbsoluteUrl = (value: string | undefined, siteUrl: string) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `${siteUrl}${value.startsWith("/") ? value : `/${value}`}`;
};

const toPublicFileAbsoluteUrl = (value: string | undefined, siteUrl: string) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  const normalized = value.startsWith("/") ? value : `/${value}`;
  const publicPath = path.join(process.cwd(), "public", normalized.slice(1));
  if (!fs.existsSync(publicPath)) return null;
  return `${siteUrl}${normalized}`;
};

const parsePipeList = (value: string | undefined) =>
  (value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);

const DEFAULT_AUTHOR_PROFILE = [
  "福岡の劇団「万能グローブ ガラパゴスダイナモス」（通称ガラパ）制作広報",
  "自分の劇団作品が大好きでもっと知ってほしいと思い日々奮闘中",
];
const DEFAULT_AUTHOR_IMAGE_PATH = "/authors/nishiyama-akihiro.jpg";

const formatBlogDate = (value?: string) => {
  if (!value) return "公開日未設定";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}/${month}.${day}`;
};

export function generateStaticParams() {
  return getAllBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string } | Promise<{ slug: string }>;
}) {
  const resolvedParams = await Promise.resolve(params);
  const post = getBlogPostBySlug(decodeRouteParam(resolvedParams.slug));
  if (!post) {
    return buildMetadata({
      title: "ブログ",
      path: "/blog",
    });
  }

  const path = `/blog/${encodeURIComponent(post.slug)}`;
  return {
    ...buildMetadata({
      title: post.frontMatter.title ?? "ブログ",
      description: post.frontMatter.description ?? undefined,
      path,
      image: post.frontMatter.cover ?? null,
    }),
  };
}

export default async function BlogDetailPage({
  params,
}: {
  params: { slug: string } | Promise<{ slug: string }>;
}) {
  const resolvedParams = await Promise.resolve(params);
  const post = getBlogPostBySlug(decodeRouteParam(resolvedParams.slug));
  if (!post) {
    notFound();
  }

  const siteUrl = getSiteUrl();
  const canonicalUrl = `${siteUrl}/blog/${encodeURIComponent(post.slug)}`;
  const publishedDate = post.frontMatter.date ?? undefined;
  const formattedDate = formatBlogDate(post.frontMatter.date);

  const authorName = post.frontMatter.author?.trim() || "福岡アクトポータル編集部";
  const authorRole =
    post.frontMatter.author_role?.trim() || "演劇・舞台コンテンツ編集";
  const authorBio = post.frontMatter.author_bio?.trim();
  const authorProfile = parsePipeList(post.frontMatter.author_profile);
  const legacyProfileItems = [
    ...parsePipeList(post.frontMatter.author_achievements),
    ...parsePipeList(post.frontMatter.author_qualifications),
  ];
  const authorProfileItems =
    authorProfile.length > 0
      ? authorProfile
      : legacyProfileItems.length > 0
        ? legacyProfileItems
        : DEFAULT_AUTHOR_PROFILE;
  const authorSummary =
    authorBio ||
    authorProfileItems.join(" / ") ||
    "福岡の演劇・舞台情報を中心に、初めて観劇する方にも伝わる記事制作と監修を行っています。";
  const authorInitial = authorName.trim().charAt(0) || "編";
  const authorKnowsAbout = Array.from(
    new Set(authorProfileItems.filter((item) => item.length > 0)),
  );
  const authorUrl = post.frontMatter.author_url?.trim() || undefined;
  const authorImage = toPublicFileAbsoluteUrl(
    post.frontMatter.author_image?.trim() || DEFAULT_AUTHOR_IMAGE_PATH,
    siteUrl,
  );

  const organizationName =
    post.frontMatter.organization_name?.trim() || "万能グローブガラパゴスダイナモス";
  const organizationUrl =
    post.frontMatter.organization_url?.trim() ||
    "https://www.galapagos-dynamos.com/";
  const organizationLogo = toAbsoluteUrl(
    post.frontMatter.organization_logo || "/icon.png?v=20260210a",
    siteUrl,
  );

  const coverImage = toAbsoluteUrl(post.frontMatter.cover, siteUrl);

  const blogPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.frontMatter.title ?? post.slug,
    description: post.frontMatter.description ?? undefined,
    datePublished: publishedDate,
    dateModified: publishedDate,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    author: {
      "@type": "Person",
      name: authorName,
      ...(authorRole ? { jobTitle: authorRole } : {}),
      ...(authorSummary ? { description: authorSummary } : {}),
      ...(authorUrl ? { url: authorUrl } : {}),
      ...(authorImage ? { image: authorImage } : {}),
      ...(authorKnowsAbout.length > 0 ? { knowsAbout: authorKnowsAbout } : {}),
    },
    publisher: {
      "@type": "Organization",
      name: organizationName,
      url: organizationUrl,
      ...(organizationLogo
        ? {
            logo: {
              "@type": "ImageObject",
              url: organizationLogo,
            },
          }
        : {}),
    },
    ...(coverImage ? { image: [coverImage] } : {}),
  };

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: organizationName,
    url: organizationUrl,
    ...(organizationLogo
      ? {
          logo: {
            "@type": "ImageObject",
            url: organizationLogo,
          },
        }
      : {}),
  };

  const faqJsonLd =
    post.faqItems.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: post.faqItems.map((item) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: item.answer,
            },
          })),
        }
      : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostingJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(organizationJsonLd),
        }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}

      <Link href="/blog" className="badge-retro bg-surface shadow-hard-sm">
        ← ブログ一覧に戻る
      </Link>

      <div className="card-retro mt-4 p-6 md:p-8">
        <div className="badge-retro bg-pop-blue text-white shadow-hard-sm text-[11px]">
          {formattedDate}
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

      <section className="card-retro mt-6 p-6 md:p-8">
        <div className="rounded-2xl border-2 border-pop-blue bg-surface p-5 shadow-hard-sm md:p-6">
          <div className="flex items-center gap-2 text-pop-blue">
            <span className="text-lg leading-none">✎</span>
            <p className="text-sm font-black tracking-[0.06em]">この記事の著者</p>
            <span className="h-[2px] flex-1 bg-pop-blue/40" />
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-pop-blue bg-pop-blue/10 sm:h-24 sm:w-24">
                {authorImage ? (
                  <img
                    src={authorImage}
                    alt={`${authorName}のプロフィール画像`}
                    className="h-full w-full object-cover object-[center_14%]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-display text-3xl text-pop-blue">
                    {authorInitial}
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <p className="text-xs text-zinc-500">{authorRole}</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">
                  {authorName}
                </h2>
                {authorUrl && (
                  <a
                    href={authorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center rounded-md bg-pop-blue px-3 py-1.5 text-xs font-black text-white shadow-hard-sm transition-opacity hover:opacity-90"
                  >
                    詳しいプロフィール
                  </a>
                )}
              </div>
            </div>

            <div className="mt-5">
              <h3 className="border-b border-zinc-300 pb-1 text-lg font-black text-ink">
                プロフィール
              </h3>
              <ul className="mt-3 space-y-2 text-sm leading-7 text-zinc-700">
                {authorProfileItems.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-[2px] text-pop-pink">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-4 text-xs text-zinc-600">
            運営組織:
            {" "}
            <a
              href={organizationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-pop-blue underline underline-offset-2"
            >
              {organizationName}
            </a>
          </p>
        </div>
      </section>

      <article
        className="content-prose content-prose--blog mt-6 rounded-2xl border-2 border-ink bg-surface p-6 shadow-hard md:p-8"
        dangerouslySetInnerHTML={{ __html: post.html }}
      />
    </div>
  );
}
