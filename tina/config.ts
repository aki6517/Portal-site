import { defineConfig } from "tinacms";

const branch =
  process.env.NEXT_PUBLIC_TINA_BRANCH ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ||
  process.env.HEAD ||
  "main";

// Tina Cloud sometimes needs to read these values directly from the repo
// to finish initial schema/branch indexing. These fallbacks are safe to commit
// because the token is read-only (content is already public on the site).
const clientId =
  process.env.NEXT_PUBLIC_TINA_CLIENT_ID || "5d26ee9f-4951-4b0c-9be0-9559c5f56f11";
const token = process.env.TINA_TOKEN || "0e0d5b84acf7c9d805c8b9b4ec4044fed73744ab";

export default defineConfig({
  branch,
  clientId,
  token,
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
        fields: [
          { name: "title", label: "タイトル", type: "string", required: true },
          { name: "description", label: "説明", type: "string" },
          { name: "date", label: "日付", type: "datetime", required: true },
          { name: "author", label: "著者", type: "string" },
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
