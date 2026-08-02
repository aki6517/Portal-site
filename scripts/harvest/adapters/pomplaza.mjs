// ぽんプラザホール公式イベントカレンダーPDFアダプタ。
// 正本: docs/harvest/DESIGN.md の pomplaza 行。
//
// http://pomplazahall.jp/files/event_YYMM.pdf は月別・命名規則固定の格子レイアウトPDF。
// pdftotext では列がバラバラに崩れる（scratchpad/pomplaza_layout.txt参照）ため、
// PDFをそのままGeminiにinline_dataで渡して構造化する（app/api/ai/analyze-flyer/route.ts
// と同じ呼び出しパターン・環境変数）。Geminiの出力は幻覚のリスクがあるため、
// 「対象月と日付が一致するか」「時刻がHH:MM形式か」を厳密にバリデーションし、
// 少しでも壊れたレコードは丸ごと破棄する（silent failure対策）。

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  getGeminiModels,
  extractJsonPayload,
  isValidDateStr,
  isValidTimeStr,
  normalizeForCompare,
  nowInJst,
  politeFetch,
  shortHash,
} from "../lib.mjs";

const VENUE_TEXT = "ぽんプラザホール";
const pad2 = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// 対象月の算出（当月から windowDays 先までに開始日がかかる月をすべて含める）
// ---------------------------------------------------------------------------

export const computeTargetMonths = (nowJst, windowDays) => {
  const endPseudoMs = nowJst.getTime() + windowDays * 24 * 60 * 60 * 1000;
  const months = [];
  let year = nowJst.getUTCFullYear();
  let month = nowJst.getUTCMonth() + 1;

  for (let i = 0; i < 6; i += 1) {
    const monthStartPseudoMs = Date.UTC(year, month - 1, 1);
    if (monthStartPseudoMs > endPseudoMs) break;
    months.push({ year, month, yymm: `${String(year).slice(-2)}${pad2(month)}` });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
};

// ---------------------------------------------------------------------------
// Gemini呼び出し
// ---------------------------------------------------------------------------

const buildPrompt = (year, month) => `
あなたは福岡市のぽんプラザホール公式イベントカレンダーPDFから公演情報を抽出するアシスタントです。
このPDFは${year}年${month}月のイベントカレンダーです（グリッドの端に前後月の日付が少し映り込むことがあります）。
カレンダー内の各公演について、以下のJSON配列のみを返してください。説明文やマークダウンのコードフェンスは不要です。

出力JSONスキーマ（配列。公演が無ければ空配列 []）:
[
  {
    "title": string,
    "company": string | null,
    "dates": [ { "date": "YYYY-MM-DD", "times": ["HH:MM", ...] } ],
    "url": string | null
  }
]

ルール:
- title は公演タイトル（『』などの記号があれば残す）
- company は主催・出演団体名。読み取れなければ null
- dates.date は ${year}-${pad2(month)} の日付のみを対象にする（前後月へはみ出す日付の回はdatesに含めない）
- times は開演時刻をHH:MM（24時間表記）で、1日に複数回あれば全て配列に入れる。読み取れない場合は空配列
- url はカレンダー内に記載されたリンク（X/Instagram/公式サイト等）。無ければnull
- 「休館日」「劇場のお仕事体験」等の劇場主催ワークショップ・抽選会・体験企画・講座・説明会は出力に含めない
- 同じ公演が複数日にわたる場合はdatesに全日程をまとめる（別々の配列要素に分けない）
`;

const callGeminiForCalendar = async ({ base64Pdf, year, month, models, apiKey }) => {
  const prompt = buildPrompt(year, month);
  const attemptErrors = [];

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: prompt },
                    { inline_data: { mime_type: "application/pdf", data: base64Pdf } },
                  ],
                },
              ],
              generationConfig: { temperature: 0.1, response_mime_type: "application/json" },
            }),
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`GEMINI_HTTP_${response.status}:${text.slice(0, 300)}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("GEMINI_EMPTY_RESPONSE");

        const items = extractJsonPayload(text);
        return { items, model };
      } catch (error) {
        attemptErrors.push(
          `${model}#${attempt}:${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  throw new Error(attemptErrors.join(" | "));
};

// ---------------------------------------------------------------------------
// バリデーション（厳密・silent failure対策）
// dateが対象月と一致しない/timesがHH:MM形式でない/titleが空のレコードは
// レコードごと破棄する（部分的に信用しない）。
// ---------------------------------------------------------------------------

const validateRawItem = (raw, year, month) => {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not_object" };

  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { ok: false, reason: "empty_title" };

  const datesRaw = Array.isArray(raw.dates) ? raw.dates : [];
  if (datesRaw.length === 0) return { ok: false, reason: "no_dates" };

  const targetYyyymm = `${year}-${pad2(month)}`;
  const dates = [];

  for (const entry of datesRaw) {
    if (!entry || typeof entry !== "object") return { ok: false, reason: "bad_date_entry" };
    const date = typeof entry.date === "string" ? entry.date.trim() : "";
    if (!isValidDateStr(date)) return { ok: false, reason: `invalid_date:${date}` };
    if (!date.startsWith(targetYyyymm)) return { ok: false, reason: `month_mismatch:${date}` };

    const timesRaw = Array.isArray(entry.times) ? entry.times : [];
    const times = [];
    for (const t of timesRaw) {
      const time = typeof t === "string" ? t.trim() : "";
      if (!time) continue;
      if (!isValidTimeStr(time)) return { ok: false, reason: `invalid_time:${time}` };
      times.push(time);
    }
    dates.push({ date, times: [...new Set(times)].sort() });
  }

  const company =
    typeof raw.company === "string" && raw.company.trim() ? raw.company.trim() : null;

  let url = null;
  if (typeof raw.url === "string" && raw.url.trim()) {
    try {
      const parsed = new URL(raw.url.trim());
      if (["http:", "https:"].includes(parsed.protocol)) url = parsed.toString();
    } catch {
      // 不正URLはurlのみ無視（レコード自体は破棄しない）
    }
  }

  return { ok: true, title, company, dates, url };
};

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

export async function fetchPomplazaRecords({ fixturesDir, windowDays, now, geminiApiKey }) {
  const warnings = [];
  const errors = [];
  const records = [];
  let skippedInvalid = 0;

  if (!geminiApiKey) {
    return {
      source: "pomplaza",
      records: [],
      warnings,
      errors,
      skippedInvalid,
      fatal: true,
      fatalReason: "GEMINI_API_KEY未設定のためpomplazaは実行できません",
    };
  }

  const nowJst = now ?? nowInJst();
  const months = computeTargetMonths(nowJst, windowDays);
  const models = getGeminiModels();

  for (const { year, month, yymm } of months) {
    const pdfUrl = `http://pomplazahall.jp/files/event_${yymm}.pdf`;
    let pdfBuffer = null;

    try {
      if (fixturesDir) {
        try {
          pdfBuffer = await readFile(path.join(fixturesDir, `pomplaza_${yymm}.pdf`));
        } catch {
          warnings.push(`pomplaza ${yymm}: フィクスチャ無し（未公開扱い）`);
          continue;
        }
      } else {
        const response = await politeFetch(pdfUrl);
        if (response.status === 404) {
          warnings.push(`pomplaza ${yymm}: 未公開（404）`);
          continue;
        }
        if (!response.ok) {
          errors.push(`pomplaza ${yymm}: PDF取得失敗 (HTTP ${response.status})`);
          continue;
        }
        pdfBuffer = Buffer.from(await response.arrayBuffer());
      }
    } catch (error) {
      errors.push(
        `pomplaza ${yymm}: PDF取得中に例外: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      warnings.push(`pomplaza ${yymm}: PDFが空でした`);
      continue;
    }

    try {
      const base64Pdf = pdfBuffer.toString("base64");
      const { items } = await callGeminiForCalendar({
        base64Pdf,
        year,
        month,
        models,
        apiKey: geminiApiKey,
      });

      for (const raw of items) {
        const validated = validateRawItem(raw, year, month);
        if (!validated.ok) {
          skippedInvalid += 1;
          continue;
        }

        const sourceUrls = [pdfUrl];
        if (validated.url) sourceUrls.push(validated.url);

        records.push({
          source: "pomplaza",
          source_key: `pomplaza:${yymm}:${shortHash(normalizeForCompare(validated.title), 8)}`,
          title: validated.title,
          company: validated.company,
          venue_text: VENUE_TEXT,
          dates: validated.dates,
          description: null,
          source_urls: sourceUrls,
        });
      }
    } catch (error) {
      errors.push(
        `pomplaza ${yymm}: Gemini抽出失敗: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (records.length === 0 && errors.length > 0) {
    return {
      source: "pomplaza",
      records,
      warnings,
      errors,
      skippedInvalid,
      fatal: true,
      fatalReason: `全ての対象月でGemini抽出に失敗しました: ${errors.join(" / ")}`,
    };
  }

  if (records.length === 0) {
    warnings.push("pomplaza: 対象期間の公演が0件でした（前回比の異常の可能性）");
  }

  return { source: "pomplaza", records, warnings, errors, skippedInvalid, fatal: false, fatalReason: null };
}
