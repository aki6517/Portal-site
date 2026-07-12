import type { Metadata } from "next";

export const SITE_NAME = "福岡アクトポータル";
export const SITE_DESCRIPTION =
  "福岡の演劇公演情報を一元管理。今の気分で公演を探せるポータルサイト。";

export const getSiteUrl = () => {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;
  return "https://fukuoka-stage.com";
};

type BuildMetadataParams = {
  title?: string;
  description?: string;
  path?: string;
  image?: string | null;
  /** trueの場合 robots: { index: false, follow: true } を出力する（終演+7日超の公演など）。 */
  noindex?: boolean;
  /** OGPのog:type。ブログ記事などは"article"を渡す（既定はwebsite）。 */
  ogType?: "website" | "article";
};

export const buildMetadata = ({
  title,
  description,
  path,
  image,
  noindex,
  ogType = "website",
}: BuildMetadataParams): Metadata => {
  const siteUrl = getSiteUrl();
  const url = path ? `${siteUrl}${path}` : siteUrl;
  const resolvedDescription = description ?? SITE_DESCRIPTION;
  const resolvedTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  // 画像未指定時は既定OG画像（app/opengraph-image.tsx、/opengraph-imageで配信）にフォールバックする。
  // Next.jsのファイル規約画像の自動マージは、ページ側がopenGraphオブジェクト自体を
  // 何も返さない場合にしか働かない（openGraph.titleやdescriptionだけでも返すと、
  // その時点でNextはファイル規約側の自動適用を行わない）。buildMetadataは全ページで
  // openGraph.title/descriptionを返すため、既定画像のURLをここで明示的に解決する。
  const resolvedImage = image
    ? /^https?:\/\//.test(image)
      ? image
      : `${siteUrl}${image.startsWith("/") ? image : `/${image}`}`
    : `${siteUrl}/opengraph-image`;

  return {
    title: resolvedTitle,
    description: resolvedDescription,
    alternates: { canonical: url },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title: resolvedTitle,
      description: resolvedDescription,
      url,
      siteName: SITE_NAME,
      type: ogType,
      images: [{ url: resolvedImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: resolvedTitle,
      description: resolvedDescription,
      images: [resolvedImage],
    },
  };
};
