// 公演情報自動収集パイプライン（harvest）のエントリポイント。
// 正本: docs/harvest/DESIGN.md
//
// 実行例:
//   node scripts/harvest/index.mjs --dry-run
//   node scripts/harvest/index.mjs --source=fpap,qgeki --window-days=70
//   node scripts/harvest/index.mjs --dry-run --fixtures /path/to/fixtures
//
// 依存: @supabase/supabase-js + node標準 + global fetch のみ（新規npm依存禁止）。
// フロー: fetch(各アダプタ) → filter(演劇以外除外) → dedupe(台帳→既存イベント類似)
//        → venue解決 → 書き込み（--dry-runなら計画のみ） → レポート(JSON stdout + Resend)。
// 値（APIキー等）は絶対にログへ出さない。

import { createClient } from "@supabase/supabase-js";
import {
  loadEnvFile,
  parseCliArgs,
  resolveVenue,
  computeVenueKey,
  venueKeysMatch,
  titleSimilarity,
  bigramSet,
  normalizeForCompare,
  isLikelyNonTheater,
  guessCategory,
  nowInJst,
  jstIsoFromDateAndTime,
  jstPartsFromUtcMs,
  dateRangeFromDates,
  shortHash,
  EDITORIAL_COMPANY_NAME,
  EDITORIAL_CONTACT_EMAIL,
} from "./lib.mjs";
import { fetchFpapRecords } from "./adapters/fpap.mjs";
import { fetchPomplazaRecords } from "./adapters/pomplaza.mjs";
import { fetchQgekiRecords } from "./adapters/qgeki.mjs";
import { fetchCorichRecords } from "./adapters/corich.mjs";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const ADAPTERS = {
  fpap: ({ fixturesDir, windowDays, now }) => fetchFpapRecords({ fixturesDir, windowDays, now }),
  pomplaza: ({ fixturesDir, windowDays, now, geminiApiKey }) =>
    fetchPomplazaRecords({ fixturesDir, windowDays, now, geminiApiKey }),
  qgeki: ({ fixturesDir, windowDays, now }) => fetchQgekiRecords({ fixturesDir, windowDays, now }),
  corich: ({ fixturesDir, windowDays, now }) => fetchCorichRecords({ fixturesDir, windowDays, now }),
};

const SOURCE_LABELS = {
  fpap: "FPAP公演カレンダー",
  pomplaza: "ぽんプラザホール",
  qgeki: "北九州芸術劇場",
  corich: "CoRich舞台芸術",
};

// pomplazaはPDF→LLM構造化を経由するため、公式一次情報のfpap/qgekiより
// ai_confidenceを保守的に設定する（DESIGN.mdに数値指定は無いため実装判断）。
// corichは劇団の自己登録データ＝一次情報だが時刻なしのため0.8。
const SOURCE_CONFIDENCE = { fpap: 0.85, qgeki: 0.85, pomplaza: 0.6, corich: 0.8 };

const DUPLICATE_SKIP_THRESHOLD = 0.55;
const DUPLICATE_DRAFT_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// 日付ヘルパー（DBのtimestamptzはUTCで返るため、素朴なslice(0,10)はJST日付として
// 誤る＝午前9時より前のJST公演がUTCでは前日になる。必ずjstPartsFromUtcMs経由で変換する）
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, "0");

const jstDateFromTimestamptz = (value) => {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const { year, month, day } = jstPartsFromUtcMs(ms);
  return `${year}-${pad2(month)}-${pad2(day)}`;
};

const pseudoJstDateStr = (jstLikeDate) => jstLikeDate.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// スケジュール構築
// ---------------------------------------------------------------------------

const buildScheduleTimes = (dates) => {
  const rows = [];
  for (const d of dates ?? []) {
    const times = Array.isArray(d.times) && d.times.length > 0 ? d.times : [null];
    for (const time of times) {
      rows.push({ label: "", end_date: null, start_date: jstIsoFromDateAndTime(d.date, time) });
    }
  }
  return rows;
};

const computeStartEnd = (dates) => {
  const { minDate, maxDate } = dateRangeFromDates(dates);
  const firstEntry = (dates ?? []).find((d) => d.date === minDate) ?? dates[0];
  const firstTime =
    firstEntry && Array.isArray(firstEntry.times) && firstEntry.times.length > 0
      ? firstEntry.times[0]
      : null;
  return {
    startDate: jstIsoFromDateAndTime(minDate, firstTime),
    endDate: `${maxDate}T23:59:00+09:00`,
  };
};

// ---------------------------------------------------------------------------
// スラッグ生成（hv-{source}-{yyyymm}-{hash6}、衝突時はhash延長）
// ---------------------------------------------------------------------------

const generateSlug = ({ source, sourceKey, categoryId, minDate, usedSlugs }) => {
  const yyyymm = minDate.replace(/-/g, "").slice(0, 6);
  let hashLen = 6;
  let candidate = "";
  do {
    const hash = shortHash(`${source}:${sourceKey}`, hashLen);
    candidate = `hv-${source}-${yyyymm}-${hash}`;
    hashLen += 2;
  } while (usedSlugs.has(`${categoryId}::${candidate}`) && hashLen <= 24);
  return candidate;
};

// ---------------------------------------------------------------------------
// dedupe: 既存events（draft/published）との会場×日程重なり×タイトル類似
// ---------------------------------------------------------------------------

const findDuplicateMatch = (record, existingEvents, venuesList) => {
  const recordVenueKey = computeVenueKey(record.venue_text, null, venuesList);
  const { minDate: recMin, maxDate: recMax } = dateRangeFromDates(record.dates);
  let best = null;

  for (const ev of existingEvents) {
    const evVenueKey = computeVenueKey(ev.venue, ev.venue_id, venuesList);
    if (!venueKeysMatch(evVenueKey, recordVenueKey)) continue;

    const evMin = jstDateFromTimestamptz(ev.start_date);
    const evMax = jstDateFromTimestamptz(ev.end_date) ?? evMin;
    if (!evMin) continue;

    const overlap = recMin <= evMax && recMax >= evMin;
    if (!overlap) continue;

    let similarity = titleSimilarity(record.title, ev.title ?? "");
    // 包含判定: 「劇団テンクウ第2回公演 羨望」vs「羨望」のように片方が
    // 冠付きの長題でbigram類似度が低く出るケースの救済。同一会場×日程重なりが
    // 前提条件なので、2文字以上の包含は実質同一公演とみなしてよい。
    const recNorm = normalizeForCompare(record.title);
    const evNorm = normalizeForCompare(ev.title ?? "");
    const shorter = recNorm.length <= evNorm.length ? recNorm : evNorm;
    const longer = recNorm.length <= evNorm.length ? evNorm : recNorm;
    if (shorter.length >= 2 && longer.includes(shorter)) {
      similarity = Math.max(similarity, 0.8);
    }
    // overlap係数（積集合/小さい方）: 「15 Minutes Made 東京/福岡 福岡公演」vs
    // 「Mrs.fictions presents『15 Minutes Made』福岡公演」のように双方に別々の
    // 冠・接尾辞が付き、包含もJaccardも届かないケースの救済。
    const setRec = bigramSet(record.title);
    const setEv = bigramSet(ev.title ?? "");
    const minSize = Math.min(setRec.size, setEv.size);
    if (minSize >= 3) {
      let intersection = 0;
      for (const item of setRec) if (setEv.has(item)) intersection += 1;
      if (intersection / minSize >= 0.7) similarity = Math.max(similarity, 0.8);
    }
    if (!best || similarity > best.similarity) {
      best = { similarity, event: ev };
    }
  }

  return best;
};

// ---------------------------------------------------------------------------
// theater解決（名前ci検索→なければ作成）
// ---------------------------------------------------------------------------

const findTheaterByName = (theatersCache, name) => {
  const target = name.trim().toLowerCase();
  return theatersCache.find((t) => (t.name ?? "").trim().toLowerCase() === target) ?? null;
};

const resolveTheaterId = async ({ companyName, theatersCache, supabase, dryRun }) => {
  const existing = findTheaterByName(theatersCache, companyName);
  if (existing) return { theaterId: existing.id, created: false };

  if (dryRun) {
    const fakeId = `dryrun-theater:${shortHash(companyName.toLowerCase(), 10)}`;
    const fake = { id: fakeId, name: companyName, status: "approved", origin: "scout" };
    theatersCache.push(fake);
    return { theaterId: fakeId, created: true };
  }

  const { data, error } = await supabase
    .from("theaters")
    .insert({
      name: companyName,
      contact_email: EDITORIAL_CONTACT_EMAIL,
      status: "approved",
      origin: "scout",
    })
    .select("id")
    .single();

  if (error) {
    // uniq_theaters_name_ci（大文字小文字無視の一意制約）違反の可能性。再取得してリトライしない。
    const { data: refetched } = await supabase
      .from("theaters")
      .select("id, name, status, origin")
      .ilike("name", companyName)
      .maybeSingle();
    if (refetched) {
      theatersCache.push(refetched);
      return { theaterId: refetched.id, created: false };
    }
    throw new Error(`THEATER_CREATE_FAILED:${error.message}`);
  }

  const created = { id: data.id, name: companyName, status: "approved", origin: "scout" };
  theatersCache.push(created);
  return { theaterId: data.id, created: true };
};

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

async function main() {
  loadEnvFile(".env.local");

  const args = parseCliArgs(process.argv.slice(2));
  const { dryRun, windowDays, fixturesDir } = args;

  const topWarnings = [];
  const requestedSourceNames = (args.sources ?? Object.keys(ADAPTERS)).filter((name) => {
    const known = Object.prototype.hasOwnProperty.call(ADAPTERS, name);
    if (!known) topWarnings.push(`unknown source ignored: ${name}`);
    return known;
  });

  if (requestedSourceNames.length === 0) {
    console.error("[harvest] no valid source specified (fpap|pomplaza|qgeki)");
    process.exitCode = 1;
    return;
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const HARVEST_REPORT_TO = process.env.HARVEST_REPORT_TO;
  const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL;
  const forcedDraftMode = process.env.HARVEST_PUBLISH === "false";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[harvest] fatal: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not set"
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- DB接続確認 兼 各種キャッシュ取得（読み取りのみ・dry-runでも実施） --------------
  let venuesList;
  let theatersCache;
  let existingEvents;
  let ledgerKeys;
  try {
    const [venuesRes, theatersRes, eventsRes, ledgerRes] = await Promise.all([
      supabase.from("venues").select("id, name, aliases"),
      supabase.from("theaters").select("id, name, status, origin"),
      supabase
        .from("events")
        .select("id, category, slug, title, company, venue_id, venue, start_date, end_date, status")
        .in("status", ["draft", "published"]),
      supabase.from("harvest_items").select("source, source_key"),
    ]);
    for (const res of [venuesRes, theatersRes, eventsRes, ledgerRes]) {
      if (res.error) throw new Error(res.error.message);
    }
    venuesList = venuesRes.data ?? [];
    theatersCache = theatersRes.data ?? [];
    existingEvents = eventsRes.data ?? [];
    ledgerKeys = new Set((ledgerRes.data ?? []).map((row) => `${row.source}::${row.source_key}`));
  } catch (error) {
    console.error(
      `[harvest] fatal: DB接続/初期読み込みに失敗しました: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
    return;
  }

  const usedSlugs = new Set(existingEvents.map((e) => `${e.category}::${e.slug}`));

  const nowJst = nowInJst();
  const windowStart = pseudoJstDateStr(nowJst);
  const windowEnd = pseudoJstDateStr(new Date(nowJst.getTime() + windowDays * 24 * 60 * 60 * 1000));

  // ---- 各アダプタfetch ------------------------------------------------------------
  const adapterResults = [];
  for (const sourceName of requestedSourceNames) {
    try {
      const result = await ADAPTERS[sourceName]({
        fixturesDir,
        windowDays,
        now: nowJst,
        geminiApiKey: GEMINI_API_KEY,
      });
      adapterResults.push(result);
    } catch (error) {
      adapterResults.push({
        source: sourceName,
        records: [],
        warnings: [],
        errors: [],
        fatal: true,
        fatalReason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const fatalSources = adapterResults.filter((r) => r.fatal);
  const allSourcesFatal = fatalSources.length === adapterResults.length;

  // ---- レポート雛形 -----------------------------------------------------------------
  const report = {
    generatedAt: new Date().toISOString(),
    dryRun,
    windowDays,
    windowStart,
    windowEnd,
    harvestPublish: !forcedDraftMode,
    requestedSources: requestedSourceNames,
    warnings: [...topWarnings],
    sources: {},
    totals: {
      fetched: 0,
      published: 0,
      draft: 0,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      ledgerSkipped: 0,
      error: 0,
    },
    emailSent: null,
    emailSkippedReason: dryRun ? "dry-run" : null,
  };

  let dryRunEventCounter = 0;

  // ---- 各ソースのレコードを処理 -----------------------------------------------------
  for (const result of adapterResults) {
    const sourceName = result.source;
    const sourceReport = {
      label: SOURCE_LABELS[sourceName] ?? sourceName,
      fetched: result.records.length,
      published: 0,
      draft: 0,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      ledgerSkipped: 0,
      error: 0,
      fatal: Boolean(result.fatal),
      fatalReason: result.fatalReason ?? null,
      fetchWarnings: result.warnings ?? [],
      fetchErrors: result.errors ?? [],
      events: [],
    };
    report.totals.fetched += result.records.length;

    for (const record of result.records) {
      const ledgerKey = `${record.source}::${record.source_key}`;
      let outcome = null;

      try {
        if (ledgerKeys.has(ledgerKey)) {
          outcome = { status: "ledger_skip", reason: "already_in_harvest_items" };
        } else if (!Array.isArray(record.dates) || record.dates.length === 0) {
          outcome = { status: "skipped_invalid", reason: "no_dates" };
        } else if (isLikelyNonTheater(record.title ?? "")) {
          // タイトルのみ判定する（lib.mjsのisLikelyNonTheaterはtitle専用に設計されている）。
          // descriptionまで含めると、正規の公演の長い紹介文中に「オーディション」等の
          // 語が偶然含まれるだけで誤除外してしまう（実データで確認済みの偽陽性）。
          outcome = { status: "skipped_invalid", reason: "non_theater_keyword" };
        } else {
          const match = findDuplicateMatch(record, existingEvents, venuesList);

          if (match && match.similarity >= DUPLICATE_SKIP_THRESHOLD) {
            outcome = {
              status: "skipped_duplicate",
              reason: "similar_existing_event",
              matchedEventId: match.event.id,
              matchedEventTitle: match.event.title,
              similarity: match.similarity,
            };
          } else {
            const forceDraft = Boolean(match && match.similarity >= DUPLICATE_DRAFT_THRESHOLD);
            const categoryId = guessCategory(`${record.title ?? ""} ${record.description ?? ""}`);
            const companyName = (record.company ?? "").trim() || EDITORIAL_COMPANY_NAME;
            const { startDate, endDate } = computeStartEnd(record.dates);
            const scheduleTimes = buildScheduleTimes(record.dates);
            const windowOk = record.dates.some((d) => d.date >= windowStart && d.date <= windowEnd);
            const hasTitle = Boolean((record.title ?? "").trim());
            const hasVenueText = Boolean((record.venue_text ?? "").trim());
            const qualityPass = hasTitle && windowOk && hasVenueText;
            const finalStatus = !forcedDraftMode && qualityPass && !forceDraft ? "published" : "draft";

            const resolvedVenue = resolveVenue(record.venue_text, venuesList);
            const { minDate } = dateRangeFromDates(record.dates);
            const slug = generateSlug({
              source: record.source,
              sourceKey: record.source_key,
              categoryId,
              minDate,
              usedSlugs,
            });

            const { theaterId } = await resolveTheaterId({
              companyName,
              theatersCache,
              supabase,
              dryRun,
            });

            const eventPayload = {
              theater_id: theaterId,
              category: categoryId,
              categories: [categoryId],
              slug,
              title: record.title,
              company: companyName,
              description: record.description ?? null,
              start_date: startDate,
              end_date: endDate,
              venue_id: resolvedVenue.venueId,
              venue: record.venue_text,
              schedule_times: scheduleTimes,
              source_urls: record.source_urls ?? [],
              status: finalStatus,
              ai_confidence: SOURCE_CONFIDENCE[record.source] ?? null,
            };

            usedSlugs.add(`${categoryId}::${slug}`);

            if (dryRun) {
              dryRunEventCounter += 1;
              const simulatedId = `dryrun-event:${dryRunEventCounter}`;
              existingEvents.push({
                id: simulatedId,
                category: categoryId,
                slug,
                title: record.title,
                company: companyName,
                venue_id: resolvedVenue.venueId,
                venue: record.venue_text,
                start_date: startDate,
                end_date: endDate,
                status: finalStatus,
              });
              outcome = {
                status: finalStatus,
                reason: qualityPass ? (forceDraft ? "weak_duplicate_downgrade" : "quality_gate_pass") : "quality_gate_fail",
                eventId: simulatedId,
                slug,
                venueId: resolvedVenue.venueId,
                startDate,
                endDate,
              };
            } else {
              const { data: inserted, error: insertError } = await supabase
                .from("events")
                .insert(eventPayload)
                .select("id")
                .single();
              if (insertError) {
                throw new Error(`EVENT_INSERT_FAILED:${insertError.message}`);
              }
              existingEvents.push({
                id: inserted.id,
                category: categoryId,
                slug,
                title: record.title,
                company: companyName,
                venue_id: resolvedVenue.venueId,
                venue: record.venue_text,
                start_date: startDate,
                end_date: endDate,
                status: finalStatus,
              });
              outcome = {
                status: finalStatus,
                reason: qualityPass ? (forceDraft ? "weak_duplicate_downgrade" : "quality_gate_pass") : "quality_gate_fail",
                eventId: inserted.id,
                slug,
                venueId: resolvedVenue.venueId,
                startDate,
                endDate,
              };
            }
          }
        }
      } catch (error) {
        outcome = {
          status: "error",
          reason: error instanceof Error ? error.message : String(error),
        };
      }

      // ---- harvest_items台帳への記録（dry-runでは一切書き込まない。ledger_skipも書かない。
      // errorも書かない＝一時障害のアイテムは次回実行で自動リトライされる） ----
      if (!dryRun && outcome.status !== "ledger_skip" && outcome.status !== "error") {
        const { error: ledgerError } = await supabase.from("harvest_items").insert({
          source: record.source,
          source_key: record.source_key,
          event_id:
            outcome.eventId && !String(outcome.eventId).startsWith("dryrun")
              ? outcome.eventId
              : outcome.matchedEventId ?? null,
          action: outcome.status,
          payload: {
            title: record.title,
            company: record.company,
            venue_text: record.venue_text,
            source_urls: record.source_urls ?? [],
            reason: outcome.reason,
            similarity: outcome.similarity ?? null,
          },
        });
        if (ledgerError) {
          sourceReport.fetchErrors.push(
            `harvest_items書き込み失敗（source_key=${record.source_key}）: ${ledgerError.message}`
          );
        } else {
          ledgerKeys.add(ledgerKey);
        }
      }

      const bucketKey = {
        ledger_skip: "ledgerSkipped",
        skipped_invalid: "skippedInvalid",
        skipped_duplicate: "skippedDuplicate",
        published: "published",
        draft: "draft",
        error: "error",
      }[outcome.status];
      sourceReport[bucketKey] += 1;
      report.totals[bucketKey] += 1;

      sourceReport.events.push({
        title: record.title,
        company: record.company,
        venue: record.venue_text,
        dates: record.dates,
        status: outcome.status,
        reason: outcome.reason,
        matchedEventTitle: outcome.matchedEventTitle,
        similarity: outcome.similarity ?? null,
      });
    }

    report.sources[sourceName] = sourceReport;
  }

  // ---- Resendへレポート送信（dry-runでは送信しない） ---------------------------------
  if (!dryRun) {
    if (!RESEND_API_KEY || !HARVEST_REPORT_TO || !CONTACT_FROM_EMAIL) {
      report.emailSent = false;
      report.emailSkippedReason = "MISSING_EMAIL_ENV";
    } else {
      const bodyLines = [
        "福岡アクトポータル 公演情報自動収集レポート",
        `実行日時: ${report.generatedAt}`,
        `対象ウィンドウ: ${windowStart} 〜 ${windowEnd}（${windowDays}日先まで）`,
        `HARVEST_PUBLISH: ${forcedDraftMode ? "false（全件draft）" : "true"}`,
        "",
      ];
      for (const sourceName of requestedSourceNames) {
        const sr = report.sources[sourceName];
        if (!sr) continue;
        bodyLines.push(`## ${sr.label}（${sourceName}）`);
        if (sr.fatal) {
          bodyLines.push(`  致命的エラー: ${sr.fatalReason}`);
        }
        if (sr.fetched === 0) {
          bodyLines.push("  警告: 取得件数が0件でした（ソース側の構造変化の可能性）");
        }
        bodyLines.push(
          `  公開:${sr.published} draft:${sr.draft} スキップ(重複):${sr.skippedDuplicate} スキップ(無効):${sr.skippedInvalid} 台帳スキップ:${sr.ledgerSkipped} エラー:${sr.error}`
        );
        for (const ev of sr.events) {
          if (ev.status === "published" || ev.status === "draft") {
            bodyLines.push(`   - [${ev.status}] ${ev.title}（${ev.venue}）`);
          }
        }
        for (const w of sr.fetchWarnings) bodyLines.push(`  warning: ${w}`);
        for (const e of sr.fetchErrors) bodyLines.push(`  error: ${e}`);
        bodyLines.push("");
      }

      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: CONTACT_FROM_EMAIL,
            to: HARVEST_REPORT_TO,
            subject: `【福岡アクトポータル】公演情報自動収集レポート (${windowStart})`,
            text: bodyLines.join("\n"),
          }),
        });
        if (!emailRes.ok) {
          const text = await emailRes.text();
          report.emailSent = false;
          report.emailSkippedReason = `RESEND_HTTP_${emailRes.status}:${text.slice(0, 300)}`;
        } else {
          report.emailSent = true;
        }
      } catch (error) {
        report.emailSent = false;
        report.emailSkippedReason = error instanceof Error ? error.message : String(error);
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));

  if (allSourcesFatal) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    `[harvest] unhandled error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
  );
  process.exitCode = 1;
});
