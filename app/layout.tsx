import type { Metadata } from "next";
import {
  Dela_Gothic_One,
  Geist_Mono,
  M_PLUS_Rounded_1c,
  Zen_Kaku_Gothic_New,
} from "next/font/google";
import Link from "next/link";
import "./globals.css";
import SiteHeader from "./_components/SiteHeader";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const zenSans = Zen_Kaku_Gothic_New({
  variable: "--font-zen-sans",
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  display: "swap",
});

const delaDisplay = Dela_Gothic_One({
  variable: "--font-dela-display",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const rounded = M_PLUS_Rounded_1c({
  variable: "--font-rounded",
  weight: ["400", "500", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

const ICON_PATH = "/icon.png?v=20260210a";

type SiteTags = {
  head_tag: string | null;
  body_start_tag: string | null;
  body_end_tag: string | null;
};

type ParsedScript = {
  attrs: Record<string, string | true>;
  content: string;
};

const EMPTY_SITE_TAGS: SiteTags = {
  head_tag: null,
  body_start_tag: null,
  body_end_tag: null,
};

const normalizeSnippet = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseScriptAttrs = (attrsText: string) => {
  const attrs: Record<string, string | true> = {};
  const attrRegex = /([:@\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRegex.exec(attrsText)) !== null) {
    const rawName = attrMatch[1];
    const rawValue = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4];
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    if (rawValue === undefined) {
      attrs[name] = true;
    } else {
      attrs[name] = rawValue;
    }
  }
  return attrs;
};

const parseHeadScripts = (snippet?: string | null) => {
  if (!snippet) return [] as ParsedScript[];
  const scripts: ParsedScript[] = [];
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(snippet)) !== null) {
    scripts.push({
      attrs: parseScriptAttrs(match[1] ?? ""),
      content: match[2] ?? "",
    });
  }
  return scripts;
};

const buildScriptProps = (attrs: Record<string, string | true>) => {
  const props: Record<string, string | boolean> = {};
  Object.entries(attrs).forEach(([name, value]) => {
    if (name.startsWith("data-")) {
      props[name] = value === true ? "" : value;
      return;
    }
    if (name === "src" && typeof value === "string") props.src = value;
    if (name === "type" && typeof value === "string") props.type = value;
    if (name === "id" && typeof value === "string") props.id = value;
    if (name === "async") props.async = true;
    if (name === "defer") props.defer = true;
    if (name === "nonce" && typeof value === "string") props.nonce = value;
    if (name === "integrity" && typeof value === "string")
      props.integrity = value;
    if (name === "crossorigin" && typeof value === "string")
      props.crossOrigin = value;
    if (name === "referrerpolicy" && typeof value === "string")
      props.referrerPolicy = value;
  });
  return props;
};

const getSiteTags = async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return EMPTY_SITE_TAGS;
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("site_settings")
      .select("head_tag, body_start_tag, body_end_tag")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return EMPTY_SITE_TAGS;
    return {
      head_tag: normalizeSnippet(data.head_tag),
      body_start_tag: normalizeSnippet(data.body_start_tag),
      body_end_tag: normalizeSnippet(data.body_end_tag),
    } satisfies SiteTags;
  } catch {
    return EMPTY_SITE_TAGS;
  }
};

export const metadata: Metadata = {
  title: "福岡アクトポータル - 福岡演劇公演ポータル",
  description:
    "福岡の演劇公演情報を一元管理。今の気分で公演を探せるポータルサイト。",
  icons: {
    icon: [{ url: ICON_PATH, type: "image/png" }],
    shortcut: ICON_PATH,
    apple: [{ url: ICON_PATH, type: "image/png" }],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const siteTags = await getSiteTags();
  const headScripts = parseHeadScripts(siteTags.head_tag);

  return (
    <html
      lang="ja"
      className={`${zenSans.variable} ${delaDisplay.variable} ${geistMono.variable} ${rounded.variable}`}
    >
      <head>
        {headScripts.map((script, index) => {
          const props = buildScriptProps(script.attrs);
          const key = `${props.id ?? "site-head-script"}-${index}`;
          if (script.content.trim().length > 0) {
            return (
              <script
                key={key}
                {...props}
                dangerouslySetInnerHTML={{ __html: script.content }}
              />
            );
          }
          return <script key={key} {...props} />;
        })}
      </head>
      <body className={`${zenSans.className} antialiased`}>
        {siteTags.body_start_tag && (
          <div
            data-site-tag-slot="body-start"
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: siteTags.body_start_tag }}
          />
        )}
        <div className="min-h-screen text-ink">
          <SiteHeader />
          <main className="pt-20 md:pt-24">{children}</main>
          <footer className="mt-16 border-t-4 border-ink bg-ink text-white">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-xs sm:flex-row sm:items-center sm:justify-between">
              <span className="opacity-90">© 2026 福岡アクトポータル</span>
              <div className="flex items-center gap-4">
                <Link href="/about" className="opacity-90 hover:opacity-100">
                  運営者情報
                </Link>
                <Link
                  href="/privacy-policy"
                  className="opacity-90 hover:opacity-100"
                >
                  プライバシーポリシー
                </Link>
              </div>
            </div>
          </footer>
        </div>
        {siteTags.body_end_tag && (
          <div
            data-site-tag-slot="body-end"
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: siteTags.body_end_tag }}
          />
        )}
      </body>
    </html>
  );
}
