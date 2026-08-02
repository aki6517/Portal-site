// FPAP公演カレンダー（公開Google Calendar・iCal）アダプタ。
// 正本: docs/harvest/DESIGN.md の fpap 行。
//
// 劇団が自己登録した公演を1公演=1つ以上のVEVENTとしてFPAPが掲載している。
// SUMMARY=公演名（多くは「会社名『タイトル』」表記）/LOCATION=会場/
// DESCRIPTION=詳細。同一（正規化タイトル×LOCATION）の複数VEVENTは
// 1公演にグルーピングし、各DTSTARTをdatesへ積む（同一プロダクションの
// 連続公演日が個別VEVENTとして分割登録されているケースへの対応）。

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  extractCompanyAndTitle,
  jstDateTimeFromIcsUtc,
  nowInJst,
  politeFetch,
} from "../lib.mjs";

export const FPAP_ICS_URL =
  "https://calendar.google.com/calendar/ical/ab9b5ce4d3bf0cb83265338ab8262a72e3c5c34851c0ea4b5f42b71404b7b751%40group.calendar.google.com/public/basic.ics";

// ---------------------------------------------------------------------------
// ICSパース（RFC5545の必要最小限: 折返し行のunfold・TEXTエスケープ解除）
// ---------------------------------------------------------------------------

const unfoldIcsLines = (raw) => {
  const rawLines = raw.split(/\r\n|\n|\r/);
  const unfolded = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      unfolded.push(line);
    }
  }
  return unfolded;
};

const unescapeIcsText = (value) =>
  (value ?? "").replace(/\\\\|\\n|\\N|\\,|\\;/g, (match) => {
    switch (match) {
      case "\\\\":
        return "\\";
      case "\\n":
      case "\\N":
        return "\n";
      case "\\,":
        return ",";
      case "\\;":
        return ";";
      default:
        return match;
    }
  });

const stripBrTags = (value) => (value ?? "").replace(/<br\s*\/?\s*>/gi, " ");

/** unfold済み行からVEVENTブロックを抜き出し、プロパティのオブジェクト配列にする */
const parseVEvents = (lines) => {
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const rawKey = line.slice(0, colonIndex);
    const rawValue = line.slice(colonIndex + 1);
    const propName = rawKey.split(";")[0].toUpperCase();
    current[propName] = rawValue;
  }

  return events;
};

const normalizeGroupKeyPart = (value) =>
  (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

export async function fetchFpapRecords({ fixturesDir, windowDays, now }) {
  const warnings = [];
  const errors = [];
  const nowJst = now ?? nowInJst();
  const windowStart = nowJst.toISOString().slice(0, 10);
  const windowEndDate = new Date(nowJst.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const windowEnd = windowEndDate.toISOString().slice(0, 10);

  let rawIcs;
  try {
    if (fixturesDir) {
      rawIcs = await readFile(path.join(fixturesDir, "fpap.ics"), "utf8");
    } else {
      const response = await politeFetch(FPAP_ICS_URL);
      if (!response.ok) {
        throw new Error(`FPAP_ICS_FETCH_FAILED:${response.status}`);
      }
      rawIcs = await response.text();
    }
  } catch (error) {
    return {
      source: "fpap",
      records: [],
      warnings,
      errors,
      fatal: true,
      fatalReason: error instanceof Error ? error.message : String(error),
    };
  }

  const lines = unfoldIcsLines(rawIcs);
  const rawEvents = parseVEvents(lines);

  if (rawEvents.length === 0) {
    return {
      source: "fpap",
      records: [],
      warnings,
      errors,
      fatal: true,
      fatalReason: "FPAP_ICS_NO_VEVENT_FOUND",
    };
  }

  // groupKey -> { title, company, location, description, sourceUrls, members: [{uid, date, time}] }
  const groups = new Map();

  for (const raw of rawEvents) {
    try {
      const uid = raw.UID;
      const summaryRaw = unescapeIcsText(raw.SUMMARY);
      const locationRaw = unescapeIcsText(raw.LOCATION);
      const descriptionRaw = stripBrTags(unescapeIcsText(raw.DESCRIPTION));
      const dtstart = raw.DTSTART;

      if (!uid || !dtstart) {
        errors.push(`fpap: DTSTART/UIDが無いVEVENTをスキップしました（UID=${uid ?? "不明"}）`);
        continue;
      }

      const dt = jstDateTimeFromIcsUtc(dtstart);
      if (!dt) {
        errors.push(`fpap: DTSTART形式が不正なVEVENTをスキップしました（UID=${uid}, DTSTART=${dtstart}）`);
        continue;
      }

      // ウィンドウ外（過去・windowDaysより先）は最初から除外する
      if (dt.date < windowStart || dt.date > windowEnd) {
        continue;
      }

      let { company, title } = extractCompanyAndTitle(summaryRaw);
      if (!company) {
        const firstDescriptionLine = descriptionRaw.split("\n")[0]?.trim() ?? "";
        const fromDescription = extractCompanyAndTitle(firstDescriptionLine);
        if (fromDescription.company) company = fromDescription.company;
      }

      const groupKey = `${normalizeGroupKeyPart(title)}::${normalizeGroupKeyPart(locationRaw)}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          title,
          company,
          venueText: locationRaw,
          description: descriptionRaw,
          members: [],
        });
      }
      groups.get(groupKey).members.push({ uid, date: dt.date, time: dt.time });
    } catch (error) {
      errors.push(
        `fpap: VEVENT処理中に例外（UID=${raw.UID ?? "不明"}）: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const records = [];
  for (const group of groups.values()) {
    if (group.members.length === 0) continue;
    const sortedMembers = [...group.members].sort((a, b) =>
      a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)
    );

    const dateMap = new Map();
    for (const member of sortedMembers) {
      if (!dateMap.has(member.date)) dateMap.set(member.date, new Set());
      dateMap.get(member.date).add(member.time);
    }
    const dates = [...dateMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, timesSet]) => ({ date, times: [...timesSet].sort() }));

    records.push({
      source: "fpap",
      source_key: sortedMembers[0].uid,
      title: group.title,
      company: group.company,
      venue_text: group.venueText,
      dates,
      description: group.description || null,
      source_urls: [FPAP_ICS_URL],
    });
  }

  if (records.length === 0) {
    warnings.push("fpap: window-days内の公演が0件でした（前回比の異常の可能性）");
  }

  return { source: "fpap", records, warnings, errors, fatal: false, fatalReason: null };
}
