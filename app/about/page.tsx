import { notFound } from "next/navigation";
import { getPageContent } from "@/lib/content";

const SITE_NAME = "福岡アクトポータル";

export async function generateMetadata() {
  return {
    title: `運営者情報 | ${SITE_NAME}`,
  };
}

export default function AboutPage() {
  const page = getPageContent("about");
  if (!page) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-bold">
        {page.frontMatter.title ?? "運営者情報"}
      </h1>
      {page.frontMatter.description && (
        <p className="mt-2 text-sm text-zinc-600">
          {page.frontMatter.description}
        </p>
      )}
      <article
        className="content-prose content-prose--page mt-6 rounded-2xl border-2 border-ink bg-surface p-6 shadow-hard md:p-8"
        dangerouslySetInnerHTML={{ __html: page.html }}
      />
    </div>
  );
}
