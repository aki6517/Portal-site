import { spawnSync } from "node:child_process";

const GALAPA_PHRASE =
  "福岡の劇団「万能グローブ ガラパゴスダイナモス」（通称ガラパ）";
const GALAPA_URL = "https://www.galapagos-dynamos.com/";

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current?.startsWith("--")) continue;
    const key = current.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }
    parsed[key] = value;
    index += 1;
  }

  return parsed;
};

const normalizeDomain = (domain) => {
  if (!domain) return "";
  if (/^https?:\/\//i.test(domain)) return domain.replace(/\/+$/, "");
  return `https://${domain.replace(/\/+$/, "")}`;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const fetchWithCurlFallback = async (url) => {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    });
    return {
      status: response.status,
      html: await response.text(),
    };
  } catch {
    const marker = "__STATUS__:";
    const result = spawnSync(
      "curl",
      ["-sS", "-L", "-o", "-", "-w", `\n${marker}%{http_code}`, url],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      const stderr = result.stderr?.trim();
      throw new Error(stderr || "curl request failed");
    }

    const stdout = result.stdout ?? "";
    const markerIndex = stdout.lastIndexOf(`\n${marker}`);
    if (markerIndex === -1) {
      throw new Error("failed to parse curl status output");
    }

    const html = stdout.slice(0, markerIndex);
    const statusText = stdout.slice(markerIndex + marker.length + 1).trim();
    const status = Number(statusText);
    if (!Number.isFinite(status)) {
      throw new Error(`invalid HTTP status from curl: ${statusText}`);
    }

    return { status, html };
  }
};

const main = async () => {
  const options = parseArgs();
  const domain = normalizeDomain(options.domain);
  const slug = options.slug;

  if (!domain || !slug) {
    console.error(
      "Usage: npm run publish:verify -- --domain portal.galapagos-dynamos.com --slug butai-yosa-wakaranai",
    );
    process.exit(1);
  }

  const baseUrl = `${domain}/blog/${encodeURIComponent(slug)}`;
  const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}_verify=${Date.now()}`;
  const failures = [];

  let response;
  try {
    response = await fetchWithCurlFallback(url);
  } catch (error) {
    console.error(`Request failed: ${url}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (response.status !== 200) {
    failures.push(`Expected HTTP 200, got ${response.status}.`);
  }

  const html = response.html;

  if (html.includes("This page could not be found.")) {
    failures.push("404 not found page detected in response HTML.");
  }

  if (/<h1[^>]*>\s*404\b/i.test(html)) {
    failures.push("404 heading detected in response HTML.");
  }

  if (html.includes(GALAPA_PHRASE)) {
    const phraseAnchorPattern = new RegExp(
      `<a\\s+[^>]*href="${escapeRegExp(GALAPA_URL)}"[^>]*>${escapeRegExp(GALAPA_PHRASE)}</a>`,
      "i",
    );
    if (!phraseAnchorPattern.test(html)) {
      failures.push(`Phrase anchor missing: ${GALAPA_PHRASE} -> ${GALAPA_URL}`);
    }
  }

  if (html.includes("<table") && !/<table[\s\S]*?<a\s+href=/i.test(html)) {
    failures.push("Table detected but no anchor link found in table content.");
  }

  if (failures.length > 0) {
    console.error(`Publish verification failed: ${baseUrl}`);
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log(`Publish verification passed: ${baseUrl}`);
  console.log("- HTTP 200");
  console.log("- 404 markers not detected");
  console.log("- Phrase anchor check passed (if phrase exists)");
  console.log("- Table link check passed (if table exists)");
};

await main();
