import { notFound } from "next/navigation";
import Link from "next/link";
import {
  formatPublishedDate,
  getAllBlogPosts,
  getBlogPostBySlug,
} from "@/lib/content";
import { buildMetadata, getSiteUrl } from "@/lib/seo";

const DEFAULT_ORGANIZATION = {
  name: "万能グローブガラパゴスダイナモス",
  url: "https://www.galapagos-dynamos.com/",
  logo: "/icon.png?v=20260210a",
};

const DEFAULT_AUTHOR = {
  role: "福岡アクトポータル 編集担当",
  bio: "福岡の演劇文化を広げるため、劇団・観客の双方に役立つ舞台情報を編集・発信しています。",
  achievements: [
    "福岡の劇団「万能グローブガラパゴスダイナモス」運営メディアの編集を担当",
    "演劇初心者にも伝わる解説記事を中心に継続発信",
  ],
  qualifications: [
    "演劇公演情報サイトの運営実務",
    "舞台・演劇領域の編集/コンテンツ制作",
  ],
};

const splitProfileList = (value?: string) =>
  value
    ?.split(/\r?\n|[|｜]/)
    .map((item) => item.trim())
    .filter(Boolean) ?? [];

const toAbsoluteUrl = (value: string | undefined, siteUrl: string) => {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return `${siteUrl}${value.startsWith("/") ? value : `/${value}`}`;
};

const buildAuthorProfile = (
  frontMatter: NonNullable<ReturnType<typeof getBlogPostBySlug>>["frontMatter"],
  siteUrl: string
) => {
  const achievements =
    splitProfileList(frontMatter.author_achievements) ||
    DEFAULT_AUTHOR.achievements;
  const qualifications =
    splitProfileList(frontMatter.author_qualifications) ||
    DEFAULT_AUTHOR.qualifications;

  return {
    name: frontMatter.author?.trim() || "福岡アクトポータル編集部",
    role: frontMatter.author_role?.trim() || DEFAULT_AUTHOR.role,
    bio: frontMatter.author_bio?.trim() || DEFAULT_AUTHOR.bio,
    url: frontMatter.author_url?.trim() || undefined,
    image: toAbsoluteUrl(frontMatter.author_image?.trim(), siteUrl),
    achievements:
      achievements.length > 0 ? achievements : DEFAULT_AUTHOR.achievements,
    qualifications:
      qualifications.length > 0 ? qualifications : DEFAULT_AUTHOR.qualifications,
    organization: {
      name:
        frontMatter.organization_name?.trim() || DEFAULT_ORGANIZATION.name,
      url: frontMatter.organization_url?.trim() || DEFAULT_ORGANIZATION.url,
      logo: toAbsoluteUrl(
        frontMatter.organization_logo?.trim() || DEFAULT_ORGANIZATION.logo,
        siteUrl
      ),
    },
  };
};

const toIsoDate = (value?: string) => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const decodeRouteParam = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
    return buildMetadata({ title: "ブログ", path: "/blog" });
  }
  return buildMetadata({
    title: post.frontMatter.title ?? "ブログ",
    description: post.frontMatter.description ?? undefined,
    path: `/blog/${encodeURIComponent(post.slug)}`,
  });
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
  const pageUrl = `${siteUrl}/blog/${encodeURIComponent(post.slug)}`;
  const publishedDate = toIsoDate(post.frontMatter.date);
  const author = buildAuthorProfile(post.frontMatter, siteUrl);

  const blogPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.frontMatter.title ?? post.slug,
    description: post.frontMatter.description ?? undefined,
    datePublished: publishedDate,
    dateModified: publishedDate,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": pageUrl,
    },
    articleSection: post.frontMatter.category ?? undefined,
    author: {
      "@type": "Person",
      name: author.name,
      url: author.url,
      image: author.image,
      description: `${author.role}。${author.bio}`,
    },
    publisher: {
      "@type": "Organization",
      name: author.organization.name,
      url: author.organization.url,
      logo: author.organization.logo
        ? {
            "@type": "ImageObject",
            url: author.organization.logo,
          }
        : undefined,
    },
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
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: author.organization.name,
    url: author.organization.url,
    logo: author.organization.logo,
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostingJsonLd) }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />

      <Link href="/blog" className="badge-retro bg-surface shadow-hard-sm">
        ← ブログ一覧に戻る
      </Link>

      <div className="card-retro mt-4 p-6 md:p-8">
        <div className="badge-retro bg-pop-blue text-white shadow-hard-sm text-[11px]">
          {formatPublishedDate(post.frontMatter.date)}
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

      <section className="card-retro mt-4 p-6 md:p-7">
        <div className="badge-retro bg-pop-yellow text-[11px]">執筆者情報</div>
        <h2 className="mt-3 text-xl font-black text-ink">{author.name}</h2>
        <p className="mt-1 text-sm font-semibold text-zinc-700">{author.role}</p>
        <p className="mt-3 text-sm leading-relaxed text-zinc-800">{author.bio}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border-2 border-ink bg-white p-4">
            <p className="text-xs font-black text-zinc-600">実績</p>
            <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed text-zinc-800">
              {author.achievements.map((item) => (
                <li key={`achievement-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border-2 border-ink bg-white p-4">
            <p className="text-xs font-black text-zinc-600">資格</p>
            <ul className="mt-2 list-disc pl-5 text-sm leading-relaxed text-zinc-800">
              {author.qualifications.map((item) => (
                <li key={`qualification-${item}`}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-4 text-xs text-zinc-600">
          運営:{" "}
          <a
            href={author.organization.url}
            className="font-semibold text-pop-blue underline decoration-2 underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            {author.organization.name}
          </a>
        </p>
      </section>

      <article
        className="content-prose content-prose--blog mt-6 rounded-2xl border-2 border-ink bg-surface p-6 shadow-hard md:p-8"
        dangerouslySetInnerHTML={{ __html: post.html }}
      />
    </div>
  );
}
