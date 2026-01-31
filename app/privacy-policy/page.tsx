import { notFound } from "next/navigation";
import { getPageContent } from "@/lib/content";

const SITE_NAME = "福岡アクトポータル";

export async function generateMetadata() {
  return {
    title: `プライバシーポリシー | ${SITE_NAME}`,
  };
}

export default function PrivacyPolicyPage() {
  const page = getPageContent("privacy-policy");
  if (!page) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold">
        {page.frontMatter.title ?? "プライバシーポリシー"}
      </h1>
      {page.frontMatter.description && (
        <p className="mt-2 text-sm text-zinc-600">
          {page.frontMatter.description}
        </p>
      )}
      <article
        className="prose prose-zinc mt-6 max-w-none"
        dangerouslySetInnerHTML={{ __html: page.html }}
      />
    </div>
  );
}
