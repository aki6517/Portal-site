import { defineConfig } from "tinacms";

const branch =
  process.env.NEXT_PUBLIC_TINA_BRANCH ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ||
  process.env.HEAD ||
  "main";

const hashString = (value: string) => {
  let hash = 0;
  for (const ch of value) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
};

const toFilenameSlug = (input: unknown) => {
  const raw = typeof input === "string" ? input.trim() : "";
  const ascii = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-./_]+|[-./_]+$/g, "");

  if (ascii) return ascii;
  if (raw) return `post-${hashString(raw)}`;
  return "";
};

export default defineConfig({
  branch,
  // Client ID is not a secret; keeping a fallback here helps Tina Cloud detect
  // the schema even when it evaluates this config without your CI env vars.
  clientId:
    process.env.NEXT_PUBLIC_TINA_CLIENT_ID || "5d26ee9f-4951-4b0c-9be0-9559c5f56f11",
  token: process.env.TINA_TOKEN || "",
  build: {
    outputFolder: "admin",
    publicFolder: "public",
  },
  media: {
    tina: {
      mediaRoot: "uploads",
      publicFolder: "public",
    },
  },
  schema: {
    collections: [
      {
        name: "blog",
        label: "ブログ",
        path: "content/blog",
        format: "md",
        defaultItem: () => ({
          date: new Date().toISOString(),
          author: "西山明宏",
          author_role: "福岡アクトポータル編集運営",
          author_profile:
            "福岡の劇団「万能グローブ ガラパゴスダイナモス」（通称ガラパ）制作広報|自分の劇団作品が大好きでもっと知ってほしいと思い日々奮闘中",
          author_image: "/authors/nishiyama-akihiro.jpg",
          category: "舞台",
        }),
        ui: {
          filename: {
            showFirst: true,
            slugify: (values) => toFilenameSlug(values?.title),
            description:
              "URLに使うファイル名です。英数字・ハイフン推奨（未入力時はタイトルから自動生成）。",
          },
        },
        fields: [
          { name: "title", label: "タイトル", type: "string", required: true },
          { name: "description", label: "説明", type: "string" },
          {
            name: "date",
            label: "日付",
            type: "datetime",
            required: true,
          },
          { name: "author", label: "著者", type: "string", required: true },
          {
            name: "author_role",
            label: "著者肩書き",
            type: "string",
            description: "例: 福岡アクトポータル 編集担当",
            required: true,
          },
          {
            name: "author_bio",
            label: "著者プロフィール",
            type: "string",
          },
          {
            name: "author_profile",
            label: "プロフィール項目",
            type: "string",
            description: "必須。2〜3項目を | 区切りで入力（例: 項目A | 項目B）",
            required: true,
          },
          {
            name: "author_achievements",
            label: "著者実績（旧互換）",
            type: "string",
            description: "旧記事互換用。新規記事では author_profile を使用してください。",
          },
          {
            name: "author_qualifications",
            label: "著者資格（旧互換）",
            type: "string",
            description: "旧記事互換用。新規記事では author_profile を使用してください。",
          },
          {
            name: "author_url",
            label: "著者ページURL",
            type: "string",
          },
          {
            name: "author_image",
            label: "著者画像URL",
            type: "string",
            description: "必須。例: /authors/nishiyama-akihiro.jpg",
            required: true,
          },
          {
            name: "organization_name",
            label: "運営組織名",
            type: "string",
          },
          {
            name: "organization_url",
            label: "運営組織URL",
            type: "string",
          },
          {
            name: "organization_logo",
            label: "運営組織ロゴURL",
            type: "string",
          },
          { name: "category", label: "カテゴリ", type: "string", required: true },
          { name: "body", label: "本文", type: "rich-text", isBody: true },
        ],
      },
      {
        name: "pages",
        label: "固定ページ",
        path: "content/pages",
        format: "md",
        fields: [
          { name: "title", label: "タイトル", type: "string", required: true },
          { name: "description", label: "説明", type: "string" },
          { name: "body", label: "本文", type: "rich-text", isBody: true },
        ],
      },
    ],
  },
});
