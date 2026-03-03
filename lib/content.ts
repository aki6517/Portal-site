import fs from "fs";
import path from "path";
import MarkdownIt from "markdown-it";

type FrontMatter = {
  title?: string;
  description?: string;
  date?: string;
  author?: string;
  author_role?: string;
  author_bio?: string;
  author_profile?: string;
  author_achievements?: string;
  author_qualifications?: string;
  author_url?: string;
  author_image?: string;
  organization_name?: string;
  organization_url?: string;
  organization_logo?: string;
  category?: string;
  cover?: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

type ContentEntry = {
  slug: string;
  frontMatter: FrontMatter;
  content: string;
  html: string;
  faqItems: FaqItem[];
};

const CONTENT_DIR = path.join(process.cwd(), "content");
const BLOG_DIR = path.join(CONTENT_DIR, "blog");
const PAGES_DIR = path.join(CONTENT_DIR, "pages");
const GALAPA_PHRASE =
  "福岡の劇団「万能グローブ ガラパゴスダイナモス」（通称ガラパ）";
const GALAPA_URL = "https://www.galapagos-dynamos.com/";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

const defaultValidateLink = markdown.validateLink.bind(markdown);
markdown.validateLink = (url: string) => {
  const normalized = url.trim().toLowerCase();
  if (normalized.startsWith("javascript:")) return false;
  if (normalized.startsWith("vbscript:")) return false;
  if (normalized.startsWith("data:") && !normalized.startsWith("data:image/")) {
    return false;
  }
  return defaultValidateLink(url);
};

const defaultLinkOpenRenderer = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (
  tokens: any[],
  idx: number,
  options: any,
  env: any,
  self: any,
) => {
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

const defaultTableOpenRenderer = markdown.renderer.rules.table_open;
markdown.renderer.rules.table_open = (
  tokens: any[],
  idx: number,
  options: any,
  env: any,
  self: any,
) => {
  const tableOpen = defaultTableOpenRenderer
    ? defaultTableOpenRenderer(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
  return `<div class="content-table-wrap">${tableOpen}`;
};

const defaultTableCloseRenderer = markdown.renderer.rules.table_close;
markdown.renderer.rules.table_close = (
  tokens: any[],
  idx: number,
  options: any,
  env: any,
  self: any,
) => {
  const tableClose = defaultTableCloseRenderer
    ? defaultTableCloseRenderer(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
  return `${tableClose}</div>`;
};

markdown.core.ruler.after("inline", "auto_link_galapa_phrase", (state: any) => {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== "inline" || !blockToken.children) continue;

    const nextChildren: any[] = [];
    let linkDepth = 0;

    for (const childToken of blockToken.children) {
      if (childToken.type === "link_open") {
        linkDepth += 1;
        nextChildren.push(childToken);
        continue;
      }

      if (childToken.type === "link_close") {
        linkDepth = Math.max(0, linkDepth - 1);
        nextChildren.push(childToken);
        continue;
      }

      if (
        linkDepth > 0 ||
        childToken.type !== "text" ||
        !childToken.content.includes(GALAPA_PHRASE)
      ) {
        nextChildren.push(childToken);
        continue;
      }

      const parts = childToken.content.split(GALAPA_PHRASE);
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] ?? "";
        if (part.length > 0) {
          const partToken = new state.Token("text", "", 0);
          partToken.content = part;
          nextChildren.push(partToken);
        }

        if (index === parts.length - 1) continue;

        const linkOpen = new state.Token("link_open", "a", 1);
        linkOpen.attrSet("href", GALAPA_URL);
        linkOpen.attrSet("target", "_blank");
        linkOpen.attrSet("rel", "noopener noreferrer");

        const linkText = new state.Token("text", "", 0);
        linkText.content = GALAPA_PHRASE;

        const linkClose = new state.Token("link_close", "a", -1);

        nextChildren.push(linkOpen, linkText, linkClose);
      }
    }

    blockToken.children = nextChildren;
  }
});

const renderMarkdown = (value: string) => markdown.render(value);

const normalizeText = (value: string) =>
  value
    .replace(/\r?\n/g, " ")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

const extractFaqItems = (value: string) => {
  const tokens = markdown.parse(value, {});
  const items: FaqItem[] = [];

  let inFaqSection = false;
  let currentQuestion = "";
  let answerParts: string[] = [];

  const pushCurrent = () => {
    const question = normalizeText(currentQuestion);
    const answer = normalizeText(answerParts.join(" "));
    if (question.length === 0 || answer.length === 0) return;
    items.push({ question, answer });
    currentQuestion = "";
    answerParts = [];
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;

    if (token.type === "heading_open") {
      const headingInline = tokens[index + 1];
      const headingText =
        headingInline?.type === "inline"
          ? normalizeText(headingInline.content ?? "")
          : "";

      if (token.tag === "h2") {
        if (currentQuestion) pushCurrent();
        inFaqSection = headingText.includes("よくある質問");
        continue;
      }

      if (!inFaqSection) continue;

      if (token.tag === "h3") {
        if (currentQuestion) pushCurrent();
        currentQuestion = headingText;
        continue;
      }

      if (/^h[1-6]$/.test(token.tag)) {
        if (currentQuestion) pushCurrent();
        inFaqSection = false;
      }
      continue;
    }

    if (!inFaqSection || currentQuestion.length === 0) continue;

    if (token.type === "inline") {
      const previousType = tokens[index - 1]?.type ?? "";
      if (previousType === "heading_open") continue;
      const text = normalizeText(token.content ?? "");
      if (text.length > 0) answerParts.push(text);
      continue;
    }

    if (token.type === "code_block" || token.type === "fence") {
      const text = normalizeText(token.content ?? "");
      if (text.length > 0) answerParts.push(text);
    }
  }

  if (currentQuestion) pushCurrent();

  return items;
};

const parseFrontMatter = (value: string) => {
  const matched = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(
    value,
  );
  if (!matched) {
    return { frontMatter: {}, content: value };
  }

  const raw = matched[1]?.trim() ?? "";
  const content = matched[2]?.trim() ?? "";
  const frontMatter: Record<string, string> = {};
  raw.split(/\r?\n/).forEach((line) => {
    if (!line || line.trim().startsWith("#")) return;
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
    faqItems: extractFaqItems(parsed.content),
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
      faqItems: data.faqItems,
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
    faqItems: data.faqItems,
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
    faqItems: data.faqItems,
  };
};
