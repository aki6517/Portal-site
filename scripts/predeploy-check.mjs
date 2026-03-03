import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REQUIRED_FILES = [
  "app/blog/[slug]/page.tsx",
  "lib/content.ts",
  "content/blog/butai-yosa-wakaranai.md",
  "public/authors/nishiyama-akihiro.jpg",
  "docs/07_blog_production_rules.md",
];

const runGit = (args) =>
  spawnSync("git", args, {
    encoding: "utf8",
  });

const fail = (message, detail = "") => {
  console.error("[deploy:check] FAILED");
  console.error(`- ${message}`);
  if (detail) console.error(detail.trimEnd());
  process.exit(1);
};

const ensureGitRepo = () => {
  const result = runGit(["rev-parse", "--show-toplevel"]);
  if (result.status !== 0) {
    fail("Gitリポジトリを判定できません。", result.stderr || result.stdout);
  }
  return result.stdout.trim();
};

const ensureMainBranch = () => {
  const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.status !== 0) {
    fail("現在ブランチを取得できません。", result.stderr || result.stdout);
  }

  const branch = result.stdout.trim();
  if (branch !== "main") {
    fail(
      `現在ブランチが '${branch}' です。Production運用では 'main' のみ許可します。`,
      "対処: git checkout main",
    );
  }
};

const ensureCleanWorktree = () => {
  const result = runGit(["status", "--porcelain"]);
  if (result.status !== 0) {
    fail("ワークツリー状態を取得できません。", result.stderr || result.stdout);
  }

  const dirty = result.stdout.trim();
  if (!dirty) return;

  fail(
    "未コミットまたは未追跡ファイルが存在します。",
    `以下を解消してから再実行してください:\n${result.stdout}`,
  );
};

const ensureRequiredFiles = (repoRoot) => {
  const missing = REQUIRED_FILES.filter(
    (relativePath) => !fs.existsSync(path.join(repoRoot, relativePath)),
  );
  if (missing.length === 0) return;

  fail(
    "デプロイ必須ファイルが不足しています。",
    missing.map((item) => `- ${item}`).join("\n"),
  );
};

const main = () => {
  const repoRoot = ensureGitRepo();
  ensureMainBranch();
  ensureCleanWorktree();
  ensureRequiredFiles(repoRoot);

  console.log("[deploy:check] PASSED");
  console.log("- branch: main");
  console.log("- worktree: clean");
  console.log(`- required files: ${REQUIRED_FILES.length} checked`);
};

main();
