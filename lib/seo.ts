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
};

export const buildMetadata = ({
  title,
  description,
  path,
  image,
}: BuildMetadataParams): Metadata => {
  const siteUrl = getSiteUrl();
  const url = path ? `${siteUrl}${path}` : siteUrl;
  const resolvedDescription = description ?? SITE_DESCRIPTION;
  const resolvedTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  const resolvedImage = image
    ? /^https?:\/\//.test(image)
      ? image
      : `${siteUrl}${image.startsWith("/") ? image : `/${image}`}`
    : null;

  return {
    title: resolvedTitle,
    description: resolvedDescription,
    alternates: { canonical: url },
    openGraph: {
      title: resolvedTitle,
      description: resolvedDescription,
      url,
      siteName: SITE_NAME,
      type: "website",
      images: resolvedImage ? [{ url: resolvedImage }] : undefined,
    },
    twitter: {
      card: resolvedImage ? "summary_large_image" : "summary",
      title: resolvedTitle,
      description: resolvedDescription,
      images: resolvedImage ? [resolvedImage] : undefined,
    },
  };
};
