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
          author: "編集部",
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
          { name: "author", label: "著者", type: "string" },
          {
            name: "author_role",
            label: "著者肩書き",
            type: "string",
            description: "例: 福岡アクトポータル 編集担当",
          },
          {
            name: "author_bio",
            label: "著者プロフィール",
            type: "string",
          },
          {
            name: "author_achievements",
            label: "著者実績",
            type: "string",
            description: "複数ある場合は | で区切る（例: 実績A | 実績B）",
          },
          {
            name: "author_qualifications",
            label: "著者資格",
            type: "string",
            description: "複数ある場合は | で区切る（例: 資格A | 資格B）",
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
          { name: "category", label: "カテゴリ", type: "string" },
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
