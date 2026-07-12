import { unstable_cache } from "next/cache";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { buildIlikeFilter } from "@/lib/search";
import { isEnded } from "@/lib/events/lifecycle";

// トップ・一覧・詳細ページのデータ取得を集約するレイヤー。
// 公開ページからは cookie依存のクライアント（createSupabaseServerClient）を使わず、
// ここで public クライアント（+ 一部 service クライアント）だけを使う。
// 本番DBに docs/sql/005_events_publish_reservation.sql が適用済みである前提で、
// 「publish_at列が無い場合の再クエリ」フォールバックは行わない。

export type ScheduleTimeRow = {
  start_date?: string | null;
  end_date?: string | null;
  label?: string | null;
};

export type EventSummary = {
  id: string;
  title: string;
  category: string;
  categories?: string[] | null;
  slug: string;
  start_date: string;
  end_date?: string | null;
  schedule_times?: ScheduleTimeRow[] | null;
  venue?: string | null;
  image_url?: string | null;
  flyer_url?: string | null;
  company?: string | null;
  publish_at?: string | null;
  reservation_start_at?: string | null;
  reservation_label?: string | null;
  ticket_url?: string | null;
};

export type EventDetail = EventSummary & {
  description: string | null;
  playwright?: string | null;
  director?: string | null;
  reservation_links?: { label?: string | null; url?: string | null }[] | null;
  venue_address: string | null;
  price_general: number | null;
  price_student: number | null;
  ticket_types?: { label?: string | null; price?: number | null; note?: string | null }[] | null;
  tags: string[] | null;
  cast?: { name?: string; role?: string; image_url?: string }[] | null;
};

export type RelatedEventSummary = {
  id: string;
  category: string;
  slug: string;
  title: string;
  publish_at?: string | null;
  start_date: string;
  venue: string | null;
  flyer_url: string | null;
  image_url: string | null;
};

export type CategorySummary = {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  sort_order?: number | null;
};

export const isReleased = (publishAt?: string | null) => {
  if (!publishAt) return true;
  const date = new Date(publishAt);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() <= Date.now();
};

const sanitizeCategoryValue = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "");

// ---------------------------------------------------------------------------
// カテゴリ
// ---------------------------------------------------------------------------

const fetchCategories = async () => {
  const client = createSupabasePublicClient();
  const { data } = await client
    .from("categories")
    .select("id, name, icon, color, sort_order")
    .order("sort_order", { ascending: true });
  return (data ?? []) as CategorySummary[];
};

export const getCategories = () =>
  unstable_cache(fetchCategories, ["categories"], {
    tags: ["categories"],
    revalidate: 3600,
  })();

// ---------------------------------------------------------------------------
// 直近30日の閲覧数（人気順ソート・トレンド集計で使う）
// event_views_daily は service_role のみ閲覧可能なRLSのため、公開データでも
// service クライアントを使う（既存の挙動を踏襲）。
// ---------------------------------------------------------------------------

export type ViewsRow = { event_id: string; views: number };

const fetchViews30d = async (): Promise<ViewsRow[]> => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const service = createSupabaseServiceClient();
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceDate = since.toISOString().slice(0, 10);
  const { data } = await service
    .from("event_views_daily")
    .select("event_id, views")
    .gte("view_date", sinceDate);
  return data ?? [];
};

export const getViews30Map = () =>
  unstable_cache(fetchViews30d, ["views-30d"], {
    tags: ["events"],
    revalidate: 600,
  })().then((rows) => {
    const map = new Map<string, number>();
    rows.forEach((row) => {
      map.set(row.event_id, (map.get(row.event_id) ?? 0) + (row.views ?? 0));
    });
    return map;
  });

// ---------------------------------------------------------------------------
// トレンド（直近30日PV上位3件）
// docs/sql/008_trending_rpc.sql の trending_events RPC をまず試す（未適用ならエラー
// になるのでJS集計にフォールバック）。RPCはevent_views_dailyを内部で参照するため、
// RLSの都合上 service クライアントで呼ぶ（anonで呼ぶとRLSに阻まれ常に0件になる）。
// ---------------------------------------------------------------------------

const TRENDING_SELECT_FIELDS =
  "id, title, category, slug, start_date, publish_at, reservation_start_at, reservation_label, ticket_url, image_url, flyer_url";

type TrendingRpcRow = { event_id: string; total_views: number };

const fetchTrendingEvents = async (): Promise<EventSummary[]> => {
  const publicClient = createSupabasePublicClient();

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // service_role未設定（ローカル等）: view集計に触れないため、直近開催順の
    // 先頭3件で代替する（トレンドではないがフォールバックとして妥当）。
    const { data } = await publicClient
      .from("events")
      .select(TRENDING_SELECT_FIELDS)
      .eq("status", "published")
      .order("start_date", { ascending: true })
      .limit(30);
    const rows = (data ?? []) as EventSummary[];
    return rows.filter((event) => isReleased(event.publish_at)).slice(0, 3);
  }

  const service = createSupabaseServiceClient();
  const rpcResult = await service.rpc("trending_events", {
    days: 30,
    max_rows: 20,
  });

  let ranked: { event_id: string; views: number }[];
  if (!rpcResult.error && Array.isArray(rpcResult.data)) {
    ranked = (rpcResult.data as TrendingRpcRow[]).map((row) => ({
      event_id: row.event_id,
      views: row.total_views,
    }));
  } else {
    // RPC未適用（docs/sql/008は現時点でファイル作成のみ）、またはエラー時は
    // 従来ロジック（30日分の全行取得→JS集計）にフォールバックする。
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceDate = since.toISOString().slice(0, 10);
    const { data: views } = await service
      .from("event_views_daily")
      .select("event_id, views")
      .gte("view_date", sinceDate);
    const map = new Map<string, number>();
    (views ?? []).forEach((row) => {
      map.set(row.event_id, (map.get(row.event_id) ?? 0) + (row.views ?? 0));
    });
    ranked = [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([event_id, views]) => ({ event_id, views }));
  }

  // ここで空なら「view実績がまだ無い」ことを意味するので、そのまま空を返す
  // （時系列フォールバックはしない＝元の挙動を踏襲）。
  if (ranked.length === 0) return [];

  const ids = ranked.map((row) => row.event_id);
  const { data: events } = await publicClient
    .from("events")
    .select(TRENDING_SELECT_FIELDS)
    .eq("status", "published")
    .in("id", ids);

  const byId = new Map(
    ((events ?? []) as EventSummary[])
      .filter((event) => isReleased(event.publish_at))
      .map((event) => [event.id, event])
  );

  return ids
    .map((id) => byId.get(id))
    .filter((event): event is EventSummary => Boolean(event))
    .slice(0, 3);
};

export const getTrendingEvents = () =>
  unstable_cache(fetchTrendingEvents, ["trending-events"], {
    tags: ["events"],
    revalidate: 600,
  })();

// ---------------------------------------------------------------------------
// 一覧（/events, /events/[category]）
// 過去公演の除外はDB側のcoarseフィルタ（end_date基準、±24h猶予）＋
// JS側のlib/events/lifecycle.isEndedによる正確なフィルタの2段構え。
// カテゴリ絞り込みもDB側（category一致 or categories配列contains）で行う。
// ---------------------------------------------------------------------------

const UPCOMING_SELECT_FIELDS =
  "id, title, category, categories, slug, start_date, end_date, schedule_times, venue, image_url, flyer_url, company, publish_at";

export type UpcomingEventsOptions = {
  category?: string;
  query?: string;
  limit?: number;
};

const fetchUpcomingEvents = async (
  category: string,
  query: string,
  limit: number
): Promise<EventSummary[]> => {
  const client = createSupabasePublicClient();
  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let request = client
    .from("events")
    .select(UPCOMING_SELECT_FIELDS)
    .eq("status", "published")
    .or(`end_date.gte.${cutoffIso},and(end_date.is.null,start_date.gte.${cutoffIso})`);

  const safeCategory = sanitizeCategoryValue(category);
  if (safeCategory) {
    request = request.or(`category.eq.${safeCategory},categories.cs.{${safeCategory}}`);
  }

  if (query) {
    const filter = buildIlikeFilter(query, ["title", "venue", "company"]);
    if (filter) request = request.or(filter);
  }

  const { data } = await request.order("start_date", { ascending: true }).limit(limit);
  const rows = (data ?? []) as EventSummary[];
  const now = new Date();
  return rows.filter((event) => isReleased(event.publish_at) && !isEnded(event, now));
};

export const getUpcomingEvents = (options: UpcomingEventsOptions = {}) => {
  const category = options.category ?? "";
  const query = options.query ?? "";
  const limit = options.limit ?? 60;

  return unstable_cache(
    () => fetchUpcomingEvents(category, query, limit),
    ["upcoming-events", category, query, String(limit)],
    { tags: ["events"], revalidate: 600 }
  )();
};

// ---------------------------------------------------------------------------
// 公演詳細（/events/[category]/[slug]）
// slug単独で検索してからカテゴリ一致で選ぶ（カテゴリ違いのURLを検知して
// ページ側でpermanentRedirectするため）。実データ取得はid単位でキャッシュし、
// event:{id} タグを個別に付与する（書き込みAPIはevents/event:{id}を両方
// revalidateTagするので、このタグ分割は将来の高粒度revalidateへの布石）。
// ---------------------------------------------------------------------------

const SLUG_LOOKUP_SELECT = "id, category, categories, slug, publish_at";

type SlugCandidate = Pick<EventDetail, "id" | "category" | "categories" | "slug" | "publish_at">;

const pickMatchedEvent = <T extends { category: string; categories?: string[] | null; publish_at?: string | null }>(
  rows: T[] | null | undefined,
  category: string
) => {
  const released = (rows ?? []).filter((item) => isReleased(item.publish_at));
  return (
    released.find(
      (item) =>
        item.category === category ||
        (Array.isArray(item.categories) && item.categories.includes(category))
    ) ?? released[0] ?? null
  );
};

const fetchEventIdBySlug = (slug: string) =>
  unstable_cache(
    async () => {
      const client = createSupabasePublicClient();
      const { data } = await client
        .from("events")
        .select(SLUG_LOOKUP_SELECT)
        .eq("slug", slug)
        .eq("status", "published")
        .returns<SlugCandidate[]>();
      return data ?? [];
    },
    ["event-id-by-slug", slug],
    { tags: ["events"], revalidate: 600 }
  )();

const fetchEventById = (id: string) =>
  unstable_cache(
    async () => {
      const client = createSupabasePublicClient();
      const { data } = await client
        .from("events")
        .select("*")
        .eq("id", id)
        .eq("status", "published")
        .maybeSingle();
      return data as EventDetail | null;
    },
    ["event-by-id", id],
    { tags: ["events", `event:${id}`], revalidate: 600 }
  )();

export const getEventById = async (id: string) => {
  const event = await fetchEventById(id);
  if (!event || !isReleased(event.publish_at)) return null;
  return event;
};

export const getEventBySlug = async (category: string, slug: string) => {
  const candidates = await fetchEventIdBySlug(slug);
  const matched = pickMatchedEvent(candidates, category);
  if (!matched) return null;
  return getEventById(matched.id);
};

// ---------------------------------------------------------------------------
// 関連公演（同カテゴリ・自分以外を開催日昇順で3件）
// ---------------------------------------------------------------------------

const RELATED_SELECT_FIELDS =
  "id, category, slug, title, publish_at, start_date, venue, flyer_url, image_url";

export const getRelatedEvents = (category: string, excludeId: string) =>
  unstable_cache(
    async () => {
      const client = createSupabasePublicClient();
      const { data } = await client
        .from("events")
        .select(RELATED_SELECT_FIELDS)
        .eq("category", category)
        .eq("status", "published")
        .neq("id", excludeId)
        .order("start_date", { ascending: true })
        .limit(10)
        .returns<RelatedEventSummary[]>();
      const rows = data ?? [];
      return rows.filter((item) => isReleased(item.publish_at)).slice(0, 3);
    },
    ["related-events", category, excludeId],
    { tags: ["events"], revalidate: 600 }
  )();
