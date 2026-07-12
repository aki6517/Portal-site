import { unstable_cache } from "next/cache";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { isReleased, type CategorySummary } from "@/lib/data/events";
import { resolveVenue, type VenueRow } from "@/lib/venues/normalize";

// 「会場×週」番組表（/calendar）のデータ取得・組み立てを担うレイヤー。
// FullCalendarを廃止し、サーバーレンダリングのCSS Gridで描画するための
// 週単位データ構造をここで作る（app/calendar/WeekTimetable.tsx が消費する）。
//
// 日付はすべてAsia/Tokyo基準で扱う。サーバーはUTCで動く前提のため、
// 「UTC深夜として表現したJST暦日」を疑似Dateとして使い回すことで、
// setUTCDate等のカレンダー演算をそのまま使えるようにしている
// （toJstMidnightPseudoDate / pseudoDateToRealUtcStart を参照）。
// この疑似Dateはあくまで「JSTの暦日」を運ぶための入れ物なので、必ず
// getUTCFullYear/getUTCMonth/getUTCDate/getUTCDayで読み出すこと
// （getFullYear等のローカルタイムゲッターは使わない）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// エリアの表示順（SQLではなくここで管理）。docs/sql/009_venues_area.sqlの
// シードで使うarea文字列と完全一致させること。
const AREA_ORDER = [
  "福岡市・天神博多",
  "福岡市その他",
  "北九州",
  "福岡県その他",
  "その他",
] as const;
const UNKNOWN_AREA: string = "その他";
const OTHER_VENUE_KEY = "__other__";
const OTHER_VENUE_NAME = "その他の会場";
const DEFAULT_CATEGORY_COLOR = "#90A4AE";

// ---------------------------------------------------------------------------
// JST日付ユーティリティ（外部依存なし・Dateの手組み）
// ---------------------------------------------------------------------------

/** 実時刻(UTC Date) → そのJST暦日をUTC深夜として表現した疑似Date */
const toJstMidnightPseudoDate = (date: Date): Date => {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  );
};

/** 疑似Date（UTC深夜表現のJST暦日） → そのJST日 00:00:00 の実UTC Instant */
const pseudoDateToRealUtcStart = (pseudo: Date): Date => new Date(pseudo.getTime() - JST_OFFSET_MS);

/** 疑似Dateをその週の月曜（同じ疑似Date表現）に丸める */
const startOfWeekPseudo = (pseudo: Date): Date => {
  const dow = pseudo.getUTCDay(); // 0=Sun..6=Sat
  const diffFromMonday = (dow + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const monday = new Date(pseudo);
  monday.setUTCDate(monday.getUTCDate() - diffFromMonday);
  return monday;
};

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" を疑似Dateにパース。不正な形式/存在しない日付は null */
const parseYmdToPseudoDate = (value: string): Date | null => {
  const match = YMD_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const pseudo = new Date(Date.UTC(year, month - 1, day));
  // ロールオーバー検知（例: 2026-02-30 のような不正日付を弾く）
  if (
    pseudo.getUTCFullYear() !== year ||
    pseudo.getUTCMonth() !== month - 1 ||
    pseudo.getUTCDate() !== day
  ) {
    return null;
  }
  return pseudo;
};

const pseudoDateToYmd = (pseudo: Date): string => pseudo.toISOString().slice(0, 10);

/**
 * ?week= クエリパラメータを "YYYY-MM-DD"（その週の月曜・JST基準）に正規化する。
 * 未指定・不正値は「今週の月曜」にフォールバックする。
 */
export const normalizeWeekParam = (raw?: string | null): string => {
  const trimmed = (raw ?? "").trim();
  const parsed = trimmed ? parseYmdToPseudoDate(trimmed) : null;
  const base = parsed ?? toJstMidnightPseudoDate(new Date());
  return pseudoDateToYmd(startOfWeekPseudo(base));
};

/** weekStartIso（月曜, YYYY-MM-DD）をdeltaWeeks週分ずらした月曜ISOを返す */
export const shiftWeekIso = (weekStartIso: string, deltaWeeks: number): string => {
  const base = parseYmdToPseudoDate(weekStartIso) ?? toJstMidnightPseudoDate(new Date());
  const shifted = new Date(base);
  shifted.setUTCDate(shifted.getUTCDate() + deltaWeeks * 7);
  return pseudoDateToYmd(startOfWeekPseudo(shifted));
};

/** /calendar への週・カテゴリ付きリンクを組み立てる（page.tsx・WeekTimetable.tsx共通） */
export const buildCalendarHref = (weekIso: string, category: string): string => {
  const params = new URLSearchParams({ week: weekIso });
  if (category) params.set("cat", category);
  return `/calendar?${params.toString()}`;
};

/** JST基準の「今日」を疑似Dateで返す（today列ハイライト判定用） */
const jstTodayPseudoDate = (now: Date = new Date()): Date => toJstMidnightPseudoDate(now);

/** days[]の要素（疑似Date）がJST基準の「今日」と同じ暦日かを判定する */
export const isJstToday = (pseudoDate: Date, now: Date = new Date()): boolean =>
  pseudoDate.getTime() === jstTodayPseudoDate(now).getTime();

// ---------------------------------------------------------------------------
// DBフェッチ（週レンジで重なるpublished公演 + venues全行 + categories全行）
// categoryFilterはキャッシュキーに含めない（全件キャッシュ→JS側フィルタにして
// カテゴリ違いのアクセスでキャッシュが断片化しないようにする）。
// ---------------------------------------------------------------------------

type WeekEventRow = {
  id: string;
  title: string;
  category: string;
  categories?: string[] | null;
  slug: string;
  start_date: string;
  end_date: string | null;
  venue: string | null;
  venue_id: string | null;
  publish_at?: string | null;
};

const WEEK_EVENT_SELECT_FIELDS =
  "id, title, category, categories, slug, start_date, end_date, venue, venue_id, publish_at";

// venuesは docs/sql/009_venues_area.sql が未適用のDBでもエラーにならないよう
// select("*") で取得し、area/aliases/sort_order はJS側で欠損時のデフォルトを
// 補う（列が存在しなければ単に undefined として返ってくるだけで、
// PostgRESTの「column does not exist」エラーにはならない）。
type VenueDbRow = {
  id: string;
  name: string;
  area?: string | null;
  aliases?: string[] | null;
  sort_order?: number | null;
};

type VenueInfo = VenueRow & {
  name: string;
  area: string | null;
  sortOrder: number;
};

type FetchedWeekData = {
  events: WeekEventRow[];
  venues: VenueInfo[];
  categories: CategorySummary[];
};

const fetchWeekData = async (weekStartIso: string): Promise<FetchedWeekData> => {
  const client = createSupabasePublicClient();

  const weekStartPseudo =
    parseYmdToPseudoDate(weekStartIso) ?? startOfWeekPseudo(toJstMidnightPseudoDate(new Date()));
  const weekEndExclusivePseudo = new Date(weekStartPseudo);
  weekEndExclusivePseudo.setUTCDate(weekEndExclusivePseudo.getUTCDate() + 7);

  const weekStartUtcIso = pseudoDateToRealUtcStart(weekStartPseudo).toISOString();
  const weekEndInclusiveUtcIso = new Date(
    pseudoDateToRealUtcStart(weekEndExclusivePseudo).getTime() - 1
  ).toISOString();

  const [eventsResult, venuesResult, categoriesResult] = await Promise.all([
    client
      .from("events")
      .select(WEEK_EVENT_SELECT_FIELDS)
      .eq("status", "published")
      .lte("start_date", weekEndInclusiveUtcIso)
      .or(`end_date.gte.${weekStartUtcIso},and(end_date.is.null,start_date.gte.${weekStartUtcIso})`)
      .order("start_date", { ascending: true }),
    client.from("venues").select("*").returns<VenueDbRow[]>(),
    client
      .from("categories")
      .select("id, name, icon, color, sort_order")
      .order("sort_order", { ascending: true }),
  ]);

  const events = (eventsResult.data ?? []) as WeekEventRow[];
  const venues: VenueInfo[] = (venuesResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    area: row.area ?? null,
    aliases: row.aliases ?? [],
    sortOrder: row.sort_order ?? 100,
  }));
  const categories = (categoriesResult.data ?? []) as CategorySummary[];

  return { events, venues, categories };
};

const getWeekDataCached = (weekStartIso: string) =>
  unstable_cache(() => fetchWeekData(weekStartIso), ["week-timetable", weekStartIso], {
    tags: ["events", "venues", "categories"],
    revalidate: 600,
  })();

// ---------------------------------------------------------------------------
// 週データの組み立て（施設へのグルーピング・サブレーン割当・カテゴリ色solve）
// ---------------------------------------------------------------------------

export type TimetableEventSummary = {
  id: string;
  title: string;
  category: string;
  slug: string;
  venue: string | null;
};

export type TimetableEventBand = {
  event: TimetableEventSummary;
  colStart: number; // CSS grid-column開始位置（venue列を1列目とし2〜8）
  colEnd: number; // CSS grid-column終了位置（inclusive。渡す時は+1して使う）
  color: string;
  hallNote: string | null;
  continuesBefore: boolean; // 会期が週の左端より前から続いている
  continuesAfter: boolean; // 会期が週の右端より後まで続いている
};

export type TimetableVenueRow = {
  name: string;
  hallNote?: string | null;
  lanes: TimetableEventBand[][];
};

export type TimetableArea = {
  label: string;
  venues: TimetableVenueRow[];
};

export type WeekTimetableResult = {
  weeks: { days: Date[] };
  areas: TimetableArea[];
  categories: CategorySummary[];
};

const areaSortIndex = (area: string | null): number => {
  const idx = AREA_ORDER.indexOf((area ?? UNKNOWN_AREA) as (typeof AREA_ORDER)[number]);
  return idx === -1 ? AREA_ORDER.length : idx;
};

/** 実時刻ISO文字列 → weekStart(疑似Date)から見た日オフセット（0=月,6=日。範囲外は負や7以上もありうる） */
const dayOffsetFromWeekStart = (iso: string, weekStartPseudo: Date): number => {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return 0;
  const dayPseudo = toJstMidnightPseudoDate(instant).getTime();
  return Math.round((dayPseudo - weekStartPseudo.getTime()) / DAY_MS);
};

/**
 * 同一施設内で会期が重なる公演をサブレーンに割り当てる（開始日順にグリーディで
 * 空きレーンへ）。呼び出し側でbandsはstart_date昇順のまま渡すこと
 * （fetchWeekDataのSQL取得順のまま加工せずに積んでいるので既に昇順）。
 */
const assignLanes = (bands: TimetableEventBand[]): TimetableEventBand[][] => {
  const lanes: TimetableEventBand[][] = [];
  for (const band of bands) {
    const lane = lanes.find((items) => items[items.length - 1].colEnd < band.colStart);
    if (lane) {
      lane.push(band);
    } else {
      lanes.push([band]);
    }
  }
  return lanes;
};

/**
 * 指定週の番組表データを組み立てる。
 * categoryFilterはキャッシュキーには使わず、キャッシュ済みの週全件データを
 * JS側でフィルタする（不正なcategoryFilterはここで無視される＝全件表示）。
 */
export const getWeekTimetable = async (
  weekStartISO: string,
  categoryFilter?: string
): Promise<WeekTimetableResult> => {
  const weekStartPseudo =
    parseYmdToPseudoDate(weekStartISO) ?? startOfWeekPseudo(toJstMidnightPseudoDate(new Date()));
  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStartPseudo);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });

  const { events, venues, categories } = await getWeekDataCached(weekStartISO);

  const categoryColorMap = new Map(categories.map((c) => [c.id, c.color ?? DEFAULT_CATEGORY_COLOR]));
  const venuesById = new Map(venues.map((v) => [v.id, v]));
  const validCategoryIds = new Set(categories.map((c) => c.id));
  const effectiveCategoryFilter =
    categoryFilter && validCategoryIds.has(categoryFilter) ? categoryFilter : undefined;

  const filtered = events.filter((event) => {
    if (!isReleased(event.publish_at)) return false;
    if (!effectiveCategoryFilter) return true;
    return (
      event.category === effectiveCategoryFilter ||
      (Array.isArray(event.categories) && event.categories.includes(effectiveCategoryFilter))
    );
  });

  type Bucket = {
    name: string;
    area: string | null;
    sortOrder: number;
    bands: TimetableEventBand[];
  };
  const buckets = new Map<string, Bucket>();

  for (const event of filtered) {
    // venue_id優先＋ランタイム正規化フォールバック（バックフィル前でも動く）
    const textResolved = resolveVenue(event.venue, venues);
    const directVenue = event.venue_id ? venuesById.get(event.venue_id) : undefined;
    const venueInfo = directVenue ?? (textResolved.venueId ? venuesById.get(textResolved.venueId) : undefined);

    const startOffset = dayOffsetFromWeekStart(event.start_date, weekStartPseudo);
    const endOffset = dayOffsetFromWeekStart(event.end_date ?? event.start_date, weekStartPseudo);
    const continuesBefore = startOffset < 0;
    const continuesAfter = endOffset > 6;
    const clampedStart = Math.min(Math.max(startOffset, 0), 6);
    const clampedEnd = Math.min(Math.max(endOffset, 0), 6);
    // +2 = (0始まりの日オフセット→1始まりに+1) + 会場名列ぶん+1
    const colStart = clampedStart + 2;
    const colEnd = Math.max(clampedEnd + 2, colStart);

    const bucketKey = venueInfo ? venueInfo.id : OTHER_VENUE_KEY;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        name: venueInfo ? venueInfo.name : OTHER_VENUE_NAME,
        area: venueInfo ? venueInfo.area : UNKNOWN_AREA,
        sortOrder: venueInfo ? venueInfo.sortOrder : Number.MAX_SAFE_INTEGER,
        bands: [],
      };
      buckets.set(bucketKey, bucket);
    }

    bucket.bands.push({
      event: {
        id: event.id,
        title: event.title,
        category: event.category,
        slug: event.slug,
        venue: event.venue,
      },
      colStart,
      colEnd,
      color: categoryColorMap.get(event.category) ?? DEFAULT_CATEGORY_COLOR,
      // マッチした施設ならホール注記（大ホール等）、未マッチなら元のvenue文字列を注記表示する
      hallNote: venueInfo ? textResolved.hallNote : (event.venue?.trim() || null),
      continuesBefore,
      continuesAfter,
    });
  }

  // 表示ラベル（null→"その他"）でまず束ねてから並べ替える。同じareaSortIndexに
  // 複数のラベル（例: null area と 未マッチ施設の"その他"）が混在しても、
  // 先にグルーピングしてからソートするので、ラベルが割れて2セクションに
  // 分裂することがない（sortOrderでのソートを先にやると起こり得た不具合）。
  const bucketsByLabel = new Map<string, Bucket[]>();
  for (const bucket of buckets.values()) {
    const label = bucket.area ?? UNKNOWN_AREA;
    const list = bucketsByLabel.get(label) ?? [];
    list.push(bucket);
    bucketsByLabel.set(label, list);
  }

  const areas: TimetableArea[] = [...bucketsByLabel.entries()]
    .sort(([a], [b]) => areaSortIndex(a) - areaSortIndex(b))
    .map(([label, bucketsInArea]) => ({
      label,
      venues: [...bucketsInArea]
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.name.localeCompare(b.name, "ja");
        })
        .map((bucket) => ({ name: bucket.name, lanes: assignLanes(bucket.bands) })),
    }));

  return { weeks: { days }, areas, categories };
};
