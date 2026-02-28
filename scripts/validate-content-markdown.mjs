import fs from "node:fs";
import path from "node:path";

const CONTENT_DIR = path.join(process.cwd(), "content");
const TARGET_DIRS = ["blog", "pages"].map((dir) => path.join(CONTENT_DIR, dir));

const isWordLike = (ch) => /[\p{L}\p{N}_]/u.test(ch);
const isStrictMidwordRiskChar = (ch) => /[A-Za-z0-9ァ-ヶー]/u.test(ch);

const isEscaped = (line, index) => {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
};

const stripInlineCode = (line) => line.replace(/`[^`]*`/g, " ");

const listMarkdownFiles = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
};

const findIssues = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/);
  const issues = [];
  let inFence = false;
  let inStrong = false;

  lines.forEach((originalLine, lineIndex) => {
    const trimmed = originalLine.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const line = stripInlineCode(originalLine);
    for (let i = 0; i < line.length - 1; i += 1) {
      if (line[i] !== "*" || line[i + 1] !== "*") continue;
      if (isEscaped(line, i)) continue;

      const isOpener = !inStrong;
      const prev = line[i - 1] ?? "";
      const next = line[i + 2] ?? "";

      const looksStrictMidwordRisk =
        isOpener && isStrictMidwordRiskChar(prev) && isStrictMidwordRiskChar(next);
      if (looksStrictMidwordRisk) {
        issues.push({
          type: "midword-strong-opener",
          line: lineIndex + 1,
          message:
            "太字開始記号(**)が英字/数字/カタカナ語の途中にあります。太字範囲の開始位置を確認してください。",
          snippet: originalLine,
        });
      }

      inStrong = !inStrong;
      i += 1;
    }
  });

  if (inStrong) {
    issues.push({
      type: "unclosed-strong",
      line: lines.length,
      message: "太字記号(**)の開始/終了が対応していません。",
      snippet: lines[lines.length - 1] ?? "",
    });
  }

  return issues;
};

const files = TARGET_DIRS.flatMap(listMarkdownFiles);
const allIssues = files.flatMap((filePath) =>
  findIssues(filePath).map((issue) => ({ ...issue, filePath }))
);

if (allIssues.length > 0) {
  console.error("Markdown validation failed.\n");
  for (const issue of allIssues) {
    const relative = path.relative(process.cwd(), issue.filePath);
    console.error(`${relative}:${issue.line} [${issue.type}]`);
    console.error(`  ${issue.message}`);
    if (issue.snippet.trim()) {
      console.error(`  > ${issue.snippet.trim()}`);
    }
    console.error("");
  }
  process.exit(1);
}

console.log(`Markdown validation passed (${files.length} files checked).`);
