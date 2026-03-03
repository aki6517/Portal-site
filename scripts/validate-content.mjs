import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";

const BLOG_DIR = path.join(process.cwd(), "content", "blog");
const GALAPA_PHRASE =
  "福岡の劇団「万能グローブ ガラパゴスダイナモス」（通称ガラパ）";
const GALAPA_URL = "https://www.galapagos-dynamos.com/";
const REQUIRED_FRONTMATTER_KEYS = ["title", "date"];

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

markdown.core.ruler.after("inline", "auto_link_galapa_phrase", (state) => {
  for (const blockToken of state.tokens) {
    if (blockToken.type !== "inline" || !blockToken.children) continue;

    const nextChildren = [];
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

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const splitFrontMatter = (raw) => {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return {
      frontMatter: {},
      frontMatterLineMap: new Map(),
      bodyLines: lines,
      bodyStartLine: 1,
    };
  }

  let endLineIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      endLineIndex = index;
      break;
    }
  }

  if (endLineIndex === -1) {
    return {
      frontMatter: {},
      frontMatterLineMap: new Map(),
      bodyLines: lines,
      bodyStartLine: 1,
    };
  }

  const frontMatter = {};
  const frontMatterLineMap = new Map();
  const frontMatterLines = lines.slice(1, endLineIndex);
  frontMatterLines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) return;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    frontMatter[key] = value;
    frontMatterLineMap.set(key, idx + 2);
  });

  return {
    frontMatter,
    frontMatterLineMap,
    bodyLines: lines.slice(endLineIndex + 1),
    bodyStartLine: endLineIndex + 2,
  };
};

const isCodeFenceBoundary = (value) => /^\s*(```|~~~)/.test(value);

const isTableRow = (value) => /^\s*\|.*\|\s*$/.test(value);
const isTableDelimiter = (value) =>
  /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(value);

const collectTableErrors = (bodyLines, bodyStartLine) => {
  const errors = [];

  for (let index = 0; index < bodyLines.length; ) {
    const line = bodyLines[index] ?? "";
    if (!isTableRow(line)) {
      index += 1;
      continue;
    }

    const tableLines = [];
    while (index < bodyLines.length && isTableRow(bodyLines[index] ?? "")) {
      tableLines.push({
        lineNumber: bodyStartLine + index,
        content: bodyLines[index] ?? "",
      });
      index += 1;
    }

    if (tableLines.length < 2) continue;
    if (!isTableDelimiter(tableLines[1]?.content ?? "")) {
      errors.push({
        line: tableLines[1]?.lineNumber ?? tableLines[0].lineNumber,
        message: "テーブルの2行目は区切り行（| --- | --- |）を必須にしてください。",
      });
    }
  }

  return errors;
};

const collectBrokenLinkErrors = (bodyLines, bodyStartLine) => {
  const errors = [];
  let inCodeFence = false;

  bodyLines.forEach((line, index) => {
    if (isCodeFenceBoundary(line)) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence) return;

    const lineNumber = bodyStartLine + index;
    if (/\[[^\]]+\]\(\s*\)/.test(line)) {
      errors.push({
        line: lineNumber,
        message: "MarkdownリンクのURLが空です。",
      });
    }

    if (/\[[^\]]+\]\([^)]*$/.test(line)) {
      errors.push({
        line: lineNumber,
        message: "Markdownリンクの閉じ括弧 ')' が不足しています。",
      });
    }

    if (!line.includes("](")) return;

    let currentIndex = line.indexOf("](");
    while (currentIndex !== -1) {
      const openBracketIndex = line.lastIndexOf("[", currentIndex);
      const closeParenIndex = line.indexOf(")", currentIndex + 2);
      if (openBracketIndex === -1 || closeParenIndex === -1) {
        errors.push({
          line: lineNumber,
          message: "Markdownリンク構文が壊れています。",
        });
        break;
      }
      currentIndex = line.indexOf("](", currentIndex + 2);
    }
  });

  return errors;
};

const collectNakedUrlErrors = (bodyLines, bodyStartLine) => {
  const errors = [];
  let inCodeFence = false;

  bodyLines.forEach((line, index) => {
    if (isCodeFenceBoundary(line)) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence) return;

    const markdownUrlRanges = [];
    const markdownLinkPattern = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
    for (const match of line.matchAll(markdownLinkPattern)) {
      const whole = match[0] ?? "";
      const url = match[1] ?? "";
      const startInWhole = whole.indexOf(url);
      if (match.index === undefined || startInWhole < 0) continue;
      const start = match.index + startInWhole;
      markdownUrlRanges.push([start, start + url.length]);
    }

    const urlPattern = /https?:\/\/[^\s<>"')]+/g;
    for (const match of line.matchAll(urlPattern)) {
      if (match.index === undefined) continue;
      const url = match[0] ?? "";
      const start = match.index;
      const end = start + url.length;
      const inMarkdownLink = markdownUrlRanges.some(
        ([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd,
      );
      if (inMarkdownLink) continue;

      errors.push({
        line: bodyStartLine + index,
        message: `裸URLを検出しました。Markdownリンク化してください: ${url}`,
      });
    }
  });

  return errors;
};

const countMatches = (value, pattern) => {
  const matches = value.match(pattern);
  return matches?.length ?? 0;
};

const collectGalapaLinkErrors = (body, bodyLines, bodyStartLine) => {
  const phraseCount = countMatches(body, new RegExp(escapeRegExp(GALAPA_PHRASE), "g"));
  if (phraseCount === 0) return [];

  const rendered = markdown.render(body);
  const anchorPattern = new RegExp(
    `<a\\s+[^>]*href="${escapeRegExp(GALAPA_URL)}"[^>]*>${escapeRegExp(GALAPA_PHRASE)}</a>`,
    "g",
  );
  const linkedCount = countMatches(rendered, anchorPattern);
  if (linkedCount >= phraseCount) return [];

  const firstLineIndex = bodyLines.findIndex((line) => line.includes(GALAPA_PHRASE));
  return [
    {
      line: firstLineIndex === -1 ? bodyStartLine : bodyStartLine + firstLineIndex,
      message: `指定文言がリンク化されていません: ${GALAPA_PHRASE}`,
    },
  ];
};

const collectFileErrors = (filepath) => {
  const raw = fs.readFileSync(filepath, "utf-8");
  const { frontMatter, frontMatterLineMap, bodyLines, bodyStartLine } = splitFrontMatter(raw);
  const body = bodyLines.join("\n");
  const errors = [];

  for (const requiredKey of REQUIRED_FRONTMATTER_KEYS) {
    const value = frontMatter[requiredKey];
    if (typeof value === "string" && value.trim().length > 0) continue;
    errors.push({
      line: frontMatterLineMap.get(requiredKey) ?? 1,
      message: `frontmatter '${requiredKey}' は必須です。`,
    });
  }

  errors.push(...collectBrokenLinkErrors(bodyLines, bodyStartLine));
  errors.push(...collectTableErrors(bodyLines, bodyStartLine));
  errors.push(...collectNakedUrlErrors(bodyLines, bodyStartLine));
  errors.push(...collectGalapaLinkErrors(body, bodyLines, bodyStartLine));

  return errors;
};

const main = () => {
  if (!fs.existsSync(BLOG_DIR)) {
    console.error(`content directory not found: ${BLOG_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(BLOG_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort();

  const allErrors = [];
  for (const file of files) {
    const filepath = path.join(BLOG_DIR, file);
    const errors = collectFileErrors(filepath);
    errors.forEach((error) => {
      allErrors.push({
        file: path.relative(process.cwd(), filepath),
        line: error.line,
        message: error.message,
      });
    });
  }

  if (allErrors.length > 0) {
    console.error("Content validation failed:");
    allErrors.forEach((error) => {
      console.error(`${error.file}:${error.line}: ${error.message}`);
    });
    process.exit(1);
  }

  console.log(`Content validation passed (${files.length} files checked).`);
};

main();
