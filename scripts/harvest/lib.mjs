// 公演情報自動収集パイプライン（harvest）の共通処理。
// 正本: docs/harvest/DESIGN.md
//
// 各アダプタ（adapters/*.mjs）とindex.mjsから使う純粋関数を集約する。
// DB接続やネットワークI/Oの「実行」自体はここに置かず、venue正規化・
// タイトル類似度・カテゴリ推定・環境変数ロードなどの副作用の少ない処理のみを置く。

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// .env.local 簡易ローダー（新規npm依存禁止のため dotenv は使わない）
// 既存の process.env は上書きしない。値は絶対にログへ出さない。
// ---------------------------------------------------------------------------

export const loadEnvFile = (path = ".env.local") => {
  if (!existsSync(path)) return { loaded: false, keyCount: 0 };
  const content = readFileSync(path, "utf8");
  let keyCount = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    keyCount += 1;
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  return { loaded: true, keyCount };
};

// ---------------------------------------------------------------------------
// CLI引数パース
// ---------------------------------------------------------------------------

export const parseCliArgs = (argv) => {
  const result = {
    dryRun: false,
    sources: null, // null = 全ソース
    windowDays: 70,
    fixturesDir: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      result.dryRun = true;
      continue;
    }
    if (arg.startsWith("--source=") || arg.startsWith("--sources=")) {
      const value = arg.slice(arg.indexOf("=") + 1);
      result.sources = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }
    if (arg.startsWith("--window-days=")) {
      const value = Number(arg.slice("--window-days=".length));
      if (Number.isFinite(value) && value > 0) result.windowDays = value;
      continue;
    }
    if (arg === "--fixtures") {
      result.fixturesDir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg.startsWith("--fixtures=")) {
      result.fixturesDir = arg.slice("--fixtures=".length);
      continue;
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// venue正規化（lib/venues/normalize.ts と同一手順のJS移植）
// 正本: lib/venues/normalize.ts の手順コメント参照。ロジックを変更したら
// 両ファイルを揃えて直すこと。
// ---------------------------------------------------------------------------

const HALL_SUFFIX_TOKENS = new Set([
  "大ホール",
  "中ホール",
  "小ホール",
  "大劇場",
  "中劇場",
  "小劇場",
  "ミュージアムホール",
  "ハーモニーホール",
  "中練習室",
  "練習室",
  "イベントホール",
]);

const stripBrackets = (value) => value.replace(/[（(][^）)]*[）)]/g, "");

// 「福岡市美術館・ミュージアムホール」のような中黒区切りをホール語分離に
// かけられるよう、・は空白扱いにする（lib/venues/normalize.tsとの差分。
// 比較時は両辺とも同じ正規化を通すので、名前自体に・を含む施設も一致する）
const dotToSpace = (value) => value.replace(/・/g, " ");

export const splitVenueString = (raw) => {
  const value = (raw ?? "").trim();
  if (!value) return { facilityName: "", hallNote: null };

  const normalized = dotToSpace(stripBrackets(value.normalize("NFKC"))).trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);

  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    if (HALL_SUFFIX_TOKENS.has(last)) {
      return {
        facilityName: tokens.slice(0, -1).join(" "),
        hallNote: last,
      };
    }
  }

  return { facilityName: normalized, hallNote: null };
};

const normalizeVenueForCompare = (value) =>
  dotToSpace(stripBrackets(value.normalize("NFKC"))).replace(/\s+/g, " ").trim();

export const resolveVenue = (raw, venues) => {
  const { facilityName, hallNote } = splitVenueString(raw);
  if (!facilityName) return { venueId: null, facilityName: "", hallNote };

  const target = normalizeVenueForCompare(facilityName);
  const match = (venues ?? []).find((venue) => {
    if (normalizeVenueForCompare(venue.name) === target) return true;
    const aliases = venue.aliases ?? [];
    return aliases.some((alias) => normalizeVenueForCompare(alias) === target);
  });

  return { venueId: match?.id ?? null, facilityName, hallNote };
};

/**
 * 会場の「同一性キー」を作る。venue_idが解決できればそれを使い、できなければ
 * 正規化した施設名文字列をキーにする（既存events.venue_idがnullの行との比較用）。
 */
export const computeVenueKey = (venueText, existingVenueId, venues) => {
  if (existingVenueId) return `id:${existingVenueId}`;
  const resolved = resolveVenue(venueText, venues);
  if (resolved.venueId) return `id:${resolved.venueId}`;
  // 未解決会場は記号・空白の揺れに強いタイトル用正規化でキー化する
  return `text:${normalizeForCompare(resolved.facilityName || venueText || "")}`;
};

/**
 * 会場キー同士の一致判定。完全一致に加え、双方が未解決（text:）の場合は
 * 片方がもう片方を含めば同一会場とみなす（例: 「SAWARAPIA」と
 * 「SAWARAPIA福岡県立ももち文化センター」）。短すぎるキーの包含は誤爆する
 * ため4文字以上に限る。
 */
export const venueKeysMatch = (a, b) => {
  if (a === b) return true;
  if (!a.startsWith("text:") || !b.startsWith("text:")) return false;
  const ta = a.slice(5);
  const tb = b.slice(5);
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  return shorter.length >= 4 && longer.includes(shorter);
};

// ---------------------------------------------------------------------------
// タイトル類似度（dedupe用）
// NFKC正規化→『』「」括弧・空白・記号除去→文字bigramのJaccard係数
// ---------------------------------------------------------------------------

const COMPARE_STRIP_PATTERN =
  /[『』「」（）()\s　・:：!！?？,.、。\-‐—―ー~〜"'“”'']/g;

export const normalizeForCompare = (value) =>
  (value ?? "")
    .normalize("NFKC")
    .replace(COMPARE_STRIP_PATTERN, "")
    .toLowerCase();

export const bigramSet = (value) => {
  const normalized = normalizeForCompare(value);
  const set = new Set();
  if (normalized.length === 0) return set;
  if (normalized.length === 1) {
    set.add(normalized);
    return set;
  }
  for (let i = 0; i < normalized.length - 1; i += 1) {
    set.add(normalized.slice(i, i + 2));
  }
  return set;
};

export const jaccardSimilarity = (setA, setB) => {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

export const titleSimilarity = (a, b) => jaccardSimilarity(bigramSet(a), bigramSet(b));

// ---------------------------------------------------------------------------
// 会社名／タイトル分離（『』または「」の外側=会社名、内側=タイトル）
// fpapのSUMMARY・qgekiのタイトルの両方で使う共通ロジック
// ---------------------------------------------------------------------------

const OPEN_TO_CLOSE = { "『": "』", "「": "」" };

export const extractCompanyAndTitle = (rawText) => {
  const text = (rawText ?? "").trim();
  if (!text) return { company: null, title: "" };

  let openIndex = -1;
  let openChar = null;
  for (const candidate of Object.keys(OPEN_TO_CLOSE)) {
    const idx = text.indexOf(candidate);
    if (idx !== -1 && (openIndex === -1 || idx < openIndex)) {
      openIndex = idx;
      openChar = candidate;
    }
  }

  if (openIndex === -1) {
    return { company: null, title: text };
  }

  const closeChar = OPEN_TO_CLOSE[openChar];
  const closeIndex = text.lastIndexOf(closeChar);
  const prefix = text.slice(0, openIndex).trim();
  const company = prefix.length > 0 ? prefix : null;
  const inner =
    closeIndex > openIndex
      ? text.slice(openIndex + 1, closeIndex).trim()
      : text.slice(openIndex + 1).trim();

  return { company, title: inner || text };
};

// ---------------------------------------------------------------------------
// 演劇以外の除外キーワード（ワークショップ・講座・抽選会・休館日等）
// ---------------------------------------------------------------------------

const NON_THEATER_KEYWORDS = [
  "ワークショップ",
  "講座",
  "抽選会",
  "休館日",
  "体験",
  "説明会",
  "オーディション",
  "講習会",
  "募集",
];

export const isLikelyNonTheater = (title) => {
  const text = title ?? "";
  return NON_THEATER_KEYWORDS.some((keyword) => text.includes(keyword));
};

// ---------------------------------------------------------------------------
// カテゴリ推定（キーワード→categories.id。デフォルトはdrama）
// ---------------------------------------------------------------------------

const CATEGORY_RULES = [
  { id: "musical", pattern: /ミュージカル/ },
  { id: "comedy", pattern: /コメディ|爆笑/ },
  { id: "dance", pattern: /ダンス/ },
  { id: "student", pattern: /学生|高校|大学/ },
  { id: "conte", pattern: /コント/ },
];

export const guessCategory = (text) => {
  const haystack = text ?? "";
  const rule = CATEGORY_RULES.find(({ pattern }) => pattern.test(haystack));
  return rule?.id ?? "drama";
};

// ---------------------------------------------------------------------------
// 日付・時刻ユーティリティ（すべてJST基準・タイムゾーン非依存）
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, "0");

/** 実行環境のローカルタイムゾーンに依存しない「今のJST」を疑似UTC Dateで返す */
export const nowInJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000);

export const jstPartsFromUtcMs = (utcMs) => {
  const shifted = new Date(utcMs + 9 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
};

/** ICSの 'YYYYMMDDTHHMMSSZ' をUTC epoch msにパース。不正形式はnull */
export const parseIcsUtcStamp = (value) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value ?? "");
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
};

/** ICSのUTC DTSTART文字列 → JSTの {date:'YYYY-MM-DD', time:'HH:MM'} */
export const jstDateTimeFromIcsUtc = (value) => {
  const utcMs = parseIcsUtcStamp(value);
  if (utcMs === null) return null;
  const { year, month, day, hour, minute } = jstPartsFromUtcMs(utcMs);
  return { date: `${year}-${pad2(month)}-${pad2(day)}`, time: `${pad2(hour)}:${pad2(minute)}` };
};

export const isValidDateStr = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return (
    check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d
  );
};

export const isValidTimeStr = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? "");

/** 'YYYY-MM-DD' + 'HH:MM'（省略時00:00） → ISO8601（+09:00固定） */
export const jstIsoFromDateAndTime = (dateStr, timeStr) => {
  const time = isValidTimeStr(timeStr) ? timeStr : "00:00";
  return `${dateStr}T${time}:00+09:00`;
};

export const dateRangeFromDates = (dates) => {
  const sorted = [...(dates ?? [])].map((d) => d.date).filter(Boolean).sort();
  return { minDate: sorted[0] ?? null, maxDate: sorted[sorted.length - 1] ?? null };
};

// ---------------------------------------------------------------------------
// ハッシュ（slug・source_key生成用）
// ---------------------------------------------------------------------------

export const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

export const shortHash = (input, length = 6) => sha256Hex(input).slice(0, length);

// ---------------------------------------------------------------------------
// Gemini呼び出し（app/api/ai/analyze-flyer/route.tsと同じ環境変数・パターン）
// ---------------------------------------------------------------------------

export const DEFAULT_GEMINI_MODELS = ["gemini-3.0-pro", "gemini-2.5-pro", "gemini-2.5-flash"];

export const getGeminiModels = () => {
  const fromEnv = (process.env.GEMINI_ANALYZE_MODELS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_GEMINI_MODELS;
};

/** analyze-flyer route の extractJson と同じ考え方（コードフェンス除去→最外殻の括弧を取り出す）。
 * pomplazaはJSON配列を期待するため [ ] にも対応し、{events:[...]} 型のラップも許容する。 */
export const extractJsonPayload = (text) => {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;
  const firstIndex = (() => {
    const bracket = candidate.indexOf("[");
    const brace = candidate.indexOf("{");
    if (bracket === -1) return brace;
    if (brace === -1) return bracket;
    return Math.min(bracket, brace);
  })();
  const lastIndex = Math.max(candidate.lastIndexOf("]"), candidate.lastIndexOf("}"));
  if (firstIndex === -1 || lastIndex === -1 || lastIndex < firstIndex) {
    throw new Error("JSON_NOT_FOUND");
  }
  const parsed = JSON.parse(candidate.slice(firstIndex, lastIndex + 1));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.events)) return parsed.events;
  if (parsed && Array.isArray(parsed.performances)) return parsed.performances;
  throw new Error("JSON_NOT_ARRAY");
};

// ---------------------------------------------------------------------------
// ネットワーク共通設定
// ---------------------------------------------------------------------------

export const HARVEST_USER_AGENT =
  "FukuokaActPortalHarvest/1.0 (+https://portal.galapagos-dynamos.com)";

export const politeFetch = (url, options = {}) =>
  fetch(url, {
    ...options,
    headers: { "User-Agent": HARVEST_USER_AGENT, ...(options.headers ?? {}) },
  });

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

export const EDITORIAL_COMPANY_NAME = "福岡アクトポータル編集部（外部情報）";
export const EDITORIAL_CONTACT_EMAIL = "pugwriting@gmail.com";
