// 北九州芸術劇場（q-geki.jp）公演一覧アダプタ。
// 正本: docs/harvest/DESIGN.md の qgeki 行。
//
// https://q-geki.jp/events/ の「公演一覧」（id="performances"、休館日等ではなく
// 実際の主催公演）セクションだけを対象にし、ジャンルタグに演劇系の表記がある
// ものだけ個別ページを取得する。「募集一覧」（id="recruit"、ワークショップ等の
// 参加者募集）セクションは対象外（scratchpad/qgeki_events.htmlで実際のDOM構造を
// 確認済み。募集一覧にも演劇タグが付くことがあるため、セクション境界で切る必要がある）。

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  extractCompanyAndTitle,
  jstPartsFromUtcMs,
  nowInJst,
  politeFetch,
  sleep,
} from "../lib.mjs";

const QGEKI_EVENTS_URL = "https://q-geki.jp/events/";
const THEATER_GENRE_PATTERN = /演劇|舞台|ミュージカル/;
const pad2 = (n) => String(n).padStart(2, "0");

const decodeHtmlEntities = (value) =>
  (value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

// ---------------------------------------------------------------------------
// 一覧ページ: id="performances" セクションから演劇系タグの項目URLを抜き出す
// ---------------------------------------------------------------------------

const extractPerformancesSection = (html) => {
  const startMarker = '<section id="performances"';
  const startIndex = html.indexOf(startMarker);
  if (startIndex === -1) return null;
  const endMarker = '<section id="recruit"';
  const endIndex = html.indexOf(endMarker, startIndex);
  return endIndex === -1 ? html.slice(startIndex) : html.slice(startIndex, endIndex);
};

const extractListingItems = (sectionHtml, windowStartDate, windowEndDate) => {
  const chunks = sectionHtml.split(/<div\s+class="tr eventItem"[^>]*>/);
  const items = [];
  // chunks[0] はセクション見出し部分（最初のeventItemより前）なので捨てる
  for (const chunk of chunks.slice(1)) {
    const hrefMatch = chunk.match(/<a href="([^"]+)"\s+itemprop="url"/);
    if (!hrefMatch) continue;

    const tags = [...chunk.matchAll(/<span class="tag">([^<]*)<\/span>/g)].map((m) =>
      decodeHtmlEntities(m[1]).trim()
    );
    if (!tags.some((tag) => THEATER_GENRE_PATTERN.test(tag))) continue;

    let url;
    try {
      url = new URL(hrefMatch[1], QGEKI_EVENTS_URL).toString();
    } catch {
      continue;
    }

    const dateMatch = chunk.match(
      /<span itemprop="startDate" class="time" content="([^"]+)"/
    );
    if (dateMatch) {
      const utcMs = Date.parse(dateMatch[1]);
      if (!Number.isNaN(utcMs)) {
        const { year, month, day } = jstPartsFromUtcMs(utcMs);
        const listedDate = `${year}-${pad2(month)}-${pad2(day)}`;
        if (listedDate < windowStartDate || listedDate > windowEndDate) continue;
      }
    }

    items.push({ url, tags });
  }
  return items;
};

// ---------------------------------------------------------------------------
// 個別ページ: title / 日程・会場（ホール名+開演時刻） を抽出
// ---------------------------------------------------------------------------

const extractTitle = (html) => {
  const h1Match = html.match(/<h1>([\s\S]*?)<\/h1>/);
  if (!h1Match) return "";
  const titles = [...h1Match[1].matchAll(/<span class="title">([^<]*)<\/span>/g)]
    .map((m) => decodeHtmlEntities(m[1]).trim())
    .filter(Boolean);
  return titles.join("　");
};

const extractCatchIntro = (html) => {
  const match = html.match(/<h2 class="entryPart_title">([^<]*)<\/h2>/);
  return match ? decodeHtmlEntities(match[1]).trim() || null : null;
};

/** 「日程・会場」ウィジェット内の最初の sideWidget_place ブロックから
 * 会場ホール名と日程（年月日+開演時刻）を抽出する。 */
const extractScheduleAndVenue = (html) => {
  const placesMatch = html.match(
    /<div class="bodyMain_places sideWidget">([\s\S]*?)<!-- \.bodyMain_places -->/
  );
  if (!placesMatch) return null;

  const placeBlocks = placesMatch[1].split('<div class="sideWidget_place">').slice(1);
  if (placeBlocks.length === 0) return null;
  const block = placeBlocks[0];

  const locationMatch = block.match(/<span class="location">\s*([^<]*?)\s*<\/span>/);
  const location = locationMatch ? decodeHtmlEntities(locationMatch[1]).trim() : "";
  if (!location) return null;

  // 単日形式では range のテキスト直後に閉じタグではなく <span class="start"> が
  // ネストするため、閉じタグは要求しない（最初のタグ開始までを日付テキストとして拾う）
  const rangeMatch = block.match(/<span class="range">([^<]*)/);
  const rangeText = rangeMatch ? decodeHtmlEntities(rangeMatch[1]) : "";
  const baseYearMatch = rangeText.match(/(\d{4})年/);
  const baseYear = baseYearMatch ? Number(baseYearMatch[1]) : nowInJst().getUTCFullYear();

  const liEntries = [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)];
  const dateMap = new Map();
  let firstMonth = null;

  for (const liMatch of liEntries) {
    const li = liMatch[1];
    const monthMatch = li.match(/<span class="day_month">([^<]*)<\/span>/);
    const dateMatch = li.match(/<span class="day_date">([^<]*)<\/span>/);
    const startMatch = li.match(/<span class="start">([^<]*)<\/span>/);
    if (!monthMatch || !dateMatch) continue;

    const month = Number(monthMatch[1].replace(/[^\d]/g, ""));
    const day = Number(dateMatch[1].replace(/[^\d]/g, ""));
    if (!month || !day) continue;
    if (firstMonth === null) firstMonth = month;

    const year = month < firstMonth ? baseYear + 1 : baseYear;
    const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;

    const time = startMatch ? decodeHtmlEntities(startMatch[1]).trim() : "";
    if (!dateMap.has(dateStr)) dateMap.set(dateStr, new Set());
    if (time && /^\d{1,2}:\d{2}$/.test(time)) {
      const [h, m] = time.split(":");
      dateMap.get(dateStr).add(`${pad2(Number(h))}:${m}`);
    }
  }

  // フォールバック: 単日公演は日別<li>リストが無く、<span class="range">に
  // 「2026年9月26日（土）<span class="start">14:00開演</span>」の形で
  // 日付と開演時刻がインラインで入る（例: /events/2026/kitty/）。
  // 「〜」の範囲表記だけで日別リストが無いページは、中日の有無が判別できない
  // ため境界の2日だけを登録する（start/endは正しくなる安全側の割り切り）。
  if (dateMap.size === 0 && rangeText) {
    const rangeDates = [...rangeText.matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g)];
    let year = baseYear;
    let prevMonth = null;
    for (const m of rangeDates) {
      if (m[1]) year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      if (!month || !day) continue;
      if (prevMonth !== null && month < prevMonth) year += 1;
      prevMonth = month;
      dateMap.set(`${year}-${pad2(month)}-${pad2(day)}`, new Set());
    }
    if (dateMap.size === 1) {
      const times = [...dateMap.values()][0];
      for (const m of block.matchAll(/<span class="start">([^<]*)<\/span>/g)) {
        const t = decodeHtmlEntities(m[1]).trim().match(/(\d{1,2}):(\d{2})/);
        if (t) times.add(`${pad2(Number(t[1]))}:${t[2]}`);
      }
    }
  }

  const dates = [...dateMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, timesSet]) => ({ date, times: [...timesSet].sort() }));

  if (dates.length === 0) return null;

  return { venueText: `北九州芸術劇場 ${location}`, dates };
};

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

export async function fetchQgekiRecords({ fixturesDir, windowDays, now }) {
  const warnings = [];
  const errors = [];
  const nowJst = now ?? nowInJst();
  const windowStartDate = nowJst.toISOString().slice(0, 10);
  const windowEndDate = new Date(
    nowJst.getTime() + windowDays * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);

  let listingHtml;
  try {
    if (fixturesDir) {
      listingHtml = await readFile(path.join(fixturesDir, "qgeki_events.html"), "utf8");
    } else {
      const response = await politeFetch(QGEKI_EVENTS_URL);
      if (!response.ok) throw new Error(`QGEKI_LISTING_FETCH_FAILED:${response.status}`);
      listingHtml = await response.text();
    }
  } catch (error) {
    return {
      source: "qgeki",
      records: [],
      warnings,
      errors,
      fatal: true,
      fatalReason: error instanceof Error ? error.message : String(error),
    };
  }

  const sectionHtml = extractPerformancesSection(listingHtml);
  if (sectionHtml === null) {
    return {
      source: "qgeki",
      records: [],
      warnings,
      errors,
      fatal: true,
      fatalReason: "QGEKI_PERFORMANCES_SECTION_NOT_FOUND（DOM構造が変わった可能性）",
    };
  }

  const listingItems = extractListingItems(sectionHtml, windowStartDate, windowEndDate);
  if (listingItems.length === 0) {
    warnings.push("qgeki: window-days内の演劇系公演が一覧に0件でした（前回比の異常の可能性）");
  }

  const records = [];
  for (let i = 0; i < listingItems.length; i += 1) {
    const { url } = listingItems[i];
    try {
      let detailHtml;
      if (fixturesDir) {
        detailHtml = await readFile(path.join(fixturesDir, "qgeki_event_sample.html"), "utf8");
      } else {
        if (i > 0) await sleep(1000); // 個別ページ取得は1秒ウェイトを入れて礼儀正しく
        const response = await politeFetch(url);
        if (!response.ok) throw new Error(`DETAIL_FETCH_FAILED:${response.status}`);
        detailHtml = await response.text();
      }

      const title = extractTitle(detailHtml);
      if (!title) {
        errors.push(`qgeki ${url}: タイトルが取得できませんでした`);
        continue;
      }

      const schedule = extractScheduleAndVenue(detailHtml);
      if (!schedule) {
        errors.push(`qgeki ${url}: 日程・会場が取得できませんでした`);
        continue;
      }

      const { company } = extractCompanyAndTitle(title);
      const description = extractCatchIntro(detailHtml);
      const sourceKey = new URL(url).pathname;

      records.push({
        source: "qgeki",
        source_key: sourceKey,
        title,
        company,
        venue_text: schedule.venueText,
        dates: schedule.dates,
        description,
        source_urls: [url],
      });
    } catch (error) {
      errors.push(
        `qgeki ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return { source: "qgeki", records, warnings, errors, fatal: false, fatalReason: null };
}
