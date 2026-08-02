// CoRich舞台芸術（stage.corich.jp）アダプタ。
// 正本: docs/harvest/DESIGN.md の corich 行。
//
// 一覧ページ（/stage?area=11=九州・沖縄）だけで タイトル/劇団名/会場/県名/期間 が
// 取れるため、個別ページへはアクセスしない（礼儀優先の軽量設計）。
// 県名（福岡県）でフィルタするので、areaフィルタがページ送りで外れても安全。
// 開演時刻は一覧に無いため date-only（品質ゲートは通る＝公開可。時刻は
// FPAP/ぽんプラザ側の同一公演が拾っていることが多く、その場合はdedupeで
// そちらが優先して残る）。
//
// 期間「2026/08/01 (土) ～ 2026/08/05 (水)」は初日と楽日の2点だけをdatesに
// 積む（中日の上演有無は一覧からは判別できないため。start/endは正しくなる）。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { politeFetch, sleep, nowInJst } from "../lib.mjs";

const CORICH_BASE = "https://stage.corich.jp";
const AREA_KYUSHU = "11";
const MAX_PAGES = 5;
const TARGET_PREF = "福岡県";

const pad2 = (n) => String(n).padStart(2, "0");

const decodeHtmlEntities = (value) =>
  (value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");

// ---------------------------------------------------------------------------
// 一覧HTMLのパース
// ---------------------------------------------------------------------------

const textOf = (block, className) => {
  const m = block.match(new RegExp(`<p class="${className}">([\\s\\S]*?)<\\/p>`));
  if (!m) return "";
  return decodeHtmlEntities(m[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
};

export const parseCorichListHtml = (html) => {
  const entries = [];
  const blocks = html.split(/<a href="\/stage\/(\d+)"[^>]*class="list-group-item/).slice(1);
  // splitの結果は [id, block, id, block, ...] の繰り返しになる
  for (let i = 0; i + 1 < blocks.length; i += 2) {
    const stageId = blocks[i];
    const block = blocks[i + 1];

    const title = textOf(block, "stage");
    const company = textOf(block, "group");

    const theaterMatch = block.match(
      /<p class="theater">([\s\S]*?)(?:<span class="pref">（([^）]*)）<\/span>)?\s*<\/p>/
    );
    const venueText = theaterMatch
      ? decodeHtmlEntities(theaterMatch[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
      : "";
    const pref = theaterMatch?.[2]?.trim() ?? "";

    const periodText = textOf(block, "period");
    const dateMatches = [...periodText.matchAll(/(\d{4})\/(\d{2})\/(\d{2})/g)];
    if (!title || dateMatches.length === 0) continue;

    const toDateStr = (m) => `${m[1]}-${m[2]}-${m[3]}`;
    const startDate = toDateStr(dateMatches[0]);
    const endDate = toDateStr(dateMatches[dateMatches.length - 1]);

    entries.push({ stageId, title, company, venueText, pref, startDate, endDate });
  }
  return entries;
};

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

export async function fetchCorichRecords({ fixturesDir, windowDays, now }) {
  const warnings = [];
  const errors = [];

  const nowJst = now ?? nowInJst();
  const windowStartDate = nowJst.toISOString().slice(0, 10);
  const windowEnd = new Date(nowJst.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const windowEndDate = windowEnd.toISOString().slice(0, 10);

  // ---- 一覧HTML取得（fixtures時はローカルファイル） ------------------------------
  const pages = [];
  if (fixturesDir) {
    for (const name of ["corich_now.html", "corich_start.html"]) {
      try {
        pages.push(await readFile(path.join(fixturesDir, name), "utf8"));
      } catch {
        warnings.push(`corich fixture無し: ${name}`);
      }
    }
    if (pages.length === 0) {
      return { source: "corich", records: [], warnings, errors, fatal: false };
    }
  } else {
    // 上演中（1ページ）＋これから（開始日順・最大MAX_PAGESページ）
    const urls = [`${CORICH_BASE}/stage?area=${AREA_KYUSHU}&type=now`];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      urls.push(`${CORICH_BASE}/stage?area=${AREA_KYUSHU}&type=start&sort=start&page=${page}`);
    }
    let stop = false;
    for (const url of urls) {
      if (stop) break;
      try {
        const res = await politeFetch(url);
        if (!res.ok) {
          errors.push(`corich ${url}: HTTP ${res.status}`);
          continue;
        }
        const html = await res.text();
        pages.push(html);
        // 開始日順ページで、全エントリがウィンドウ終端より先ならそれ以上めくらない
        if (url.includes("type=start")) {
          const entries = parseCorichListHtml(html);
          if (entries.length === 0) stop = true;
          if (entries.length > 0 && entries.every((e) => e.startDate > windowEndDate)) stop = true;
        }
      } catch (error) {
        errors.push(`corich ${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await sleep(1000);
    }
    if (pages.length === 0) {
      return {
        source: "corich",
        records: [],
        warnings,
        errors,
        fatal: true,
        fatalReason: "一覧ページを1つも取得できませんでした",
      };
    }
  }

  // ---- パース→福岡県×ウィンドウでフィルタ→stageId単位で重複統合 --------------------
  const byId = new Map();
  for (const html of pages) {
    for (const entry of parseCorichListHtml(html)) {
      if (entry.pref !== TARGET_PREF) continue;
      const overlap = entry.startDate <= windowEndDate && entry.endDate >= windowStartDate;
      if (!overlap) continue;
      if (!byId.has(entry.stageId)) byId.set(entry.stageId, entry);
    }
  }

  const records = [...byId.values()].map((entry) => {
    const dates =
      entry.startDate === entry.endDate
        ? [{ date: entry.startDate, times: [] }]
        : [
            { date: entry.startDate, times: [] },
            { date: entry.endDate, times: [] },
          ];
    return {
      source: "corich",
      source_key: `/stage/${entry.stageId}`,
      title: entry.title,
      company: entry.company || null,
      venue_text: entry.venueText,
      dates,
      description: null,
      source_urls: [`${CORICH_BASE}/stage/${entry.stageId}`],
    };
  });

  return { source: "corich", records, warnings, errors, fatal: false };
}
