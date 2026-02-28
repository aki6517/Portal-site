import fs from "fs";
import path from "path";
import MarkdownIt from "markdown-it";

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

const toReadableDate = (year: string, month: string, day: string) =>
  `${year}/${month}.${day}`;

export const formatPublishedDate = (value?: string | null) => {
  if (!value) return "公開日未設定";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "公開日未設定";

  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    return toReadableDate(ymdMatch[1], ymdMatch[2], ymdMatch[3]);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;

  return toReadableDate(
    String(parsed.getFullYear()),
    String(parsed.getMonth() + 1).padStart(2, "0"),
    String(parsed.getDate()).padStart(2, "0")
  );
};

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

const defaultValidateLink = markdown.validateLink.bind(markdown);
markdown.validateLink = (url) => {
  const normalized = url.trim().toLowerCase();
  if (normalized.startsWith("javascript:")) return false;
  if (normalized.startsWith("vbscript:")) return false;
  if (normalized.startsWith("data:") && !normalized.startsWith("data:image/")) {
    return false;
  }
  return defaultValidateLink(url);
};

const defaultLinkOpenRenderer = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet("href") ?? "";
  if (/^https?:\/\//i.test(href)) {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
  }

  if (defaultLinkOpenRenderer) {
    return defaultLinkOpenRenderer(tokens, idx, options, env, self);
  }
  return self.renderToken(tokens, idx, options);
};

const renderMarkdown = (value: string) => markdown.render(value);

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
  const files = fs.readdirSync(BLOG_DIR).filter((file) => file.endsWith(".md"));

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
