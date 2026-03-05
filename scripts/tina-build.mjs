import fs from "node:fs";
import { spawnSync } from "node:child_process";

const tryLoadDotenv = async () => {
  const candidates = [".env.local", ".env"];
  const existing = candidates.find((p) => fs.existsSync(p));
  if (!existing) return;

  try {
    const dotenv = await import("dotenv");
    dotenv.config({ path: existing });
  } catch {
    // dotenv is a transitive dependency of @tinacms/cli, but if it's missing,
    // we still continue and rely on process.env.
  }
};

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const syncTinaLock = () => {
  const generatedDir = "tina/__generated__";
  const schemaPath = `${generatedDir}/_schema.json`;
  const lookupPath = `${generatedDir}/_lookup.json`;
  const graphqlPath = `${generatedDir}/_graphql.json`;
  const lockPath = "tina/tina-lock.json";

  if (![schemaPath, lookupPath, graphqlPath].every((p) => fs.existsSync(p))) {
    return;
  }

  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const lookup = JSON.parse(fs.readFileSync(lookupPath, "utf8"));
  const graphql = JSON.parse(fs.readFileSync(graphqlPath, "utf8"));

  fs.writeFileSync(lockPath, JSON.stringify({ schema, lookup, graphql }));
};

await tryLoadDotenv();

const missing = [];
if (!process.env.NEXT_PUBLIC_TINA_CLIENT_ID) missing.push("NEXT_PUBLIC_TINA_CLIENT_ID");
if (!process.env.TINA_TOKEN) missing.push("TINA_TOKEN");

if (missing.length > 0) {
  console.error(
    [
      "Tina build error: missing required environment variables.",
      `Missing: ${missing.join(", ")}`,
      "",
      "Local: add them to .env.local",
      "Vercel: add them to Project Settings → Environment Variables (Production)",
    ].join("\n"),
  );
  process.exit(1);
}

run("node", ["scripts/validate-content-markdown.mjs"]);
run("npx", ["tinacms", "build", "--skip-cloud-checks"]);
syncTinaLock();
run("npx", ["next", "build"]);
