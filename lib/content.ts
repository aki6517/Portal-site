import fs from "fs";
import path from "path";

type FrontMatter = {
  title?: string;
  description?: string;
  date?: string;
  author?: string;
  category?: string;
  cover?: string;
};

type ContentEntry = {
  slug: string;
  frontMatter: FrontMatter;
  content: string;
  html: string;
};

const CONTENT_DIR = path.join(process.cwd(), "content");
const BLOG_DIR = path.join(CONTENT_DIR, "blog");
const PAGES_DIR = path.join(CONTENT_DIR, "pages");

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const sanitizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("javascript:")) return "#";
  return trimmed;
};

const formatInline = (value: string) => {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[(.+?)\]\((.+?)\)/g, (_, text, url) => {
      const href = sanitizeUrl(url);
      const isExternal = /^https?:\/\//.test(href);
      const extra = isExternal
        ? ' target="_blank" rel="noopener noreferrer"'
        : "";
      return `<a href="${href}"${extra}>${text}</a>`;
    });
};

const renderMarkdown = (value: string) => {
  const lines = value.split(/\r?\n/);
  let html = "";
  let inList = false;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html += `<p>${formatInline(paragraph.join(" "))}</p>`;
    paragraph = [];
  };

  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${formatInline(line.slice(2))}</li>`;
      continue;
    }

    closeList();

    if (line.startsWith("### ")) {
      flushParagraph();
      html += `<h3>${formatInline(line.slice(4))}</h3>`;
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      html += `<h2>${formatInline(line.slice(3))}</h2>`;
      continue;
    }
    if (line.startsWith("# ")) {
      flushParagraph();
      html += `<h1>${formatInline(line.slice(2))}</h1>`;
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  return html;
};

const parseFrontMatter = (value: string) => {
  if (!value.startsWith("---")) {
    return { frontMatter: {}, content: value };
  }
  const end = value.indexOf("\n---", 3);
  if (end === -1) {
    return { frontMatter: {}, content: value };
  }
  const raw = value.slice(3, end).trim();
  const content = value.slice(end + 4).trim();
  const frontMatter: Record<string, string> = {};
  raw.split(/\r?\n/).forEach((line) => {
    const index = line.indexOf(":");
    if (index === -1) return;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    frontMatter[key] = rawValue.replace(/^['"]|['"]$/g, "");
  });
  return { frontMatter, content };
};

const readFile = (filepath: string) => {
  const raw = fs.readFileSync(filepath, "utf-8");
  const parsed = parseFrontMatter(raw);
  return {
    frontMatter: parsed.frontMatter as FrontMatter,
    content: parsed.content,
    html: renderMarkdown(parsed.content),
  };
};

export const getAllBlogPosts = () => {
  if (!fs.existsSync(BLOG_DIR)) return [] as ContentEntry[];
  const files = fs
    .readdirSync(BLOG_DIR)
    .filter((file) => file.endsWith(".md"));

  const posts = files.map((file) => {
    const slug = file.replace(/\.md$/, "");
    const filepath = path.join(BLOG_DIR, file);
    const data = readFile(filepath);
    return {
      slug,
      frontMatter: data.frontMatter,
      content: data.content,
      html: data.html,
    };
  });

  return posts.sort((a, b) => {
    const aDate = a.frontMatter.date ?? "";
    const bDate = b.frontMatter.date ?? "";
    return bDate.localeCompare(aDate);
  });
};

export const getBlogPostBySlug = (slug: string) => {
  const filepath = path.join(BLOG_DIR, `${slug}.md`);
  if (!fs.existsSync(filepath)) return null;
  const data = readFile(filepath);
  return {
    slug,
    frontMatter: data.frontMatter,
    content: data.content,
    html: data.html,
  };
};

export const getPageContent = (slug: string) => {
  const filepath = path.join(PAGES_DIR, `${slug}.md`);
  if (!fs.existsSync(filepath)) return null;
  const data = readFile(filepath);
  return {
    slug,
    frontMatter: data.frontMatter,
    content: data.content,
    html: data.html,
  };
};
