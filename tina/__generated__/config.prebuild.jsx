// tina/config.ts
import { defineConfig } from "tinacms";
var branch = process.env.NEXT_PUBLIC_TINA_BRANCH || "main";
var config_default = defineConfig({
  branch,
  clientId: process.env.NEXT_PUBLIC_TINA_CLIENT_ID || "",
  token: process.env.TINA_TOKEN || "",
  build: {
    outputFolder: "admin",
    publicFolder: "public"
  },
  media: {
    tina: {
      mediaRoot: "uploads",
      publicFolder: "public"
    }
  },
  schema: {
    collections: [
      {
        name: "blog",
        label: "\u30D6\u30ED\u30B0",
        path: "content/blog",
        format: "md",
        fields: [
          { name: "title", label: "\u30BF\u30A4\u30C8\u30EB", type: "string", required: true },
          { name: "description", label: "\u8AAC\u660E", type: "string" },
          { name: "date", label: "\u65E5\u4ED8", type: "datetime", required: true },
          { name: "author", label: "\u8457\u8005", type: "string" },
          { name: "category", label: "\u30AB\u30C6\u30B4\u30EA", type: "string" },
          { name: "body", label: "\u672C\u6587", type: "rich-text", isBody: true }
        ]
      },
      {
        name: "pages",
        label: "\u56FA\u5B9A\u30DA\u30FC\u30B8",
        path: "content/pages",
        format: "md",
        fields: [
          { name: "title", label: "\u30BF\u30A4\u30C8\u30EB", type: "string", required: true },
          { name: "description", label: "\u8AAC\u660E", type: "string" },
          { name: "body", label: "\u672C\u6587", type: "rich-text", isBody: true }
        ]
      }
    ]
  }
});
export {
  config_default as default
};
