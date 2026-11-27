import { unstable_cache } from "next/cache";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { buildIlikeFilter } from "@/lib/search";
import { getEffectiveEnd, isEnded, shouldNoindex } from "@/lib/events/lifecycle";
import { throwIfSupabaseError } from "@/lib/data/supabaseError";

// トップ・一覧・詳細ページのデータ取得を集約するレイヤー。
// 公開ページからは cookie依存のクライアント（createSupabaseServerClient）を使わず、
// ここで public クライアント（+ 一部 service クライアント）だけを使う。
// 本番DBに docs/sql/005_events_publish_reservation.sql が適用済みである前提で、
// 「publish_at列が無い場合の再クエリ」フォールバックは行わない。
//
// キャッシュされる関数の中で Supabase が error を返したら、空の値を返さずに例外を投げる
// （throwIfSupabaseError）。例外は unstable_cache に保存されないので、一時的な通信エラーの
// 「空の結果」がキャッシュに残らない。ページ側でも握りつぶさない（握りつぶすと、今度は
// ページ単位のキャッシュに空のページが残る）。

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
  superseded_by?: string | null;
  // AIスカウト（portal-scout）が参照した出典URL。1件以上あれば「AI自動収集由来」の
  // 公演とみなし、詳細ページで「主催者の方はご自身で更新できます」告知を出す判定に使う
  // （docs/sql/011_scout_fields.sqlでDBカラム追加。未適用DBではselect("*")でも
  // undefinedのまま返るだけなので、常にoptionalとして扱う）。
  source_urls?: string[] | null;
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
  const { data, error } = await client
    .from("categories")
    .select("id, name, icon, color, sort_order")
    .order("sort_order", { ascending: true });
  throwIfSupabaseError("categories", error);
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
  const { data, error } = await service
    .from("event_views_daily")
    .select("event_id, views")
    .gte("view_date", sinceDate);
  throwIfSupabaseError("views-30d", error);
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
    const { data, error } = await publicClient
      .from("events")
      .select(TRENDING_SELECT_FIELDS)
      .eq("status", "published")
      .order("start_date", { ascending: true })
      .limit(30);
    throwIfSupabaseError("trending-events (no service key)", error);
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
    // フォールバック先の取得がエラーなら、空として扱わずに例外を投げる。
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceDate = since.toISOString().slice(0, 10);
    const { data: views, error: viewsError } = await service
      .from("event_views_daily")
      .select("event_id, views")
      .gte("view_date", sinceDate);
    throwIfSupabaseError("trending-events (views fallback)", viewsError);
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
  const { data: events, error: eventsError } = await publicClient
    .from("events")
    .select(TRENDING_SELECT_FIELDS)
    .eq("status", "published")
    .in("id", ids);
  throwIfSupabaseError("trending-events (events)", eventsError);

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
// 編集部おすすめ（トップのPICK UP固定枠）
// featured_at が設定された公開中・未終演のイベントのうち featured_at が最新の
// 1件を返す。無ければ null（トップは従来どおりトレンド1位を表示する）。
// migrations/20260802100012 未適用のDB（featured_at 列が無い）ではエラーになるので null に
// フォールバックする。null にするのは「featured_at の列が無い」エラーのときだけで、それ以外の
// エラー（通信エラー・選んでいるほかの列が無い、など）は例外を投げる。
// ---------------------------------------------------------------------------

const FEATURED_SELECT_FIELDS =
  "id, title, category, slug, start_date, end_date, schedule_times, publish_at, reservation_start_at, reservation_label, ticket_url, image_url, flyer_url";

// PostgreSQL の undefined_column。PostgREST は PostgreSQL のエラーをそのまま転送するので、
// 存在しない列で絞り込み・並べ替えをすると PostgrestError.code がこの値になり、message は
// 「column events.<列名> does not exist」の形になる。どの列が無いかは message で見分ける。
const PG_UNDEFINED_COLUMN = "42703";

const fetchFeaturedEvent = async (): Promise<EventSummary | null> => {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("events")
    .select(FEATURED_SELECT_FIELDS)
    .eq("status", "published")
    .not("featured_at", "is", null)
    .order("featured_at", { ascending: false })
    .limit(5);
  if (error?.code === PG_UNDEFINED_COLUMN && error.message.includes("featured_at")) return null;
  throwIfSupabaseError("featured-event", error);
  const rows = (data ?? []) as EventSummary[];
  return (
    rows.find((event) => isReleased(event.publish_at) && !isEnded(event)) ?? null
  );
};

export const getFeaturedEvent = () =>
  unstable_cache(fetchFeaturedEvent, ["featured-event"], {
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

  const { data, error } = await request.order("start_date", { ascending: true }).limit(limit);
  throwIfSupabaseError("upcoming-events", error);
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

// 同じ slug の公開中の候補から1件を選ぶ。公演のURLは /events/{主カテゴリ}/{slug} の1つだけで、
// categories（2つ目からのカテゴリ）は一覧の絞り込み・表示に使うタグとして扱い、URLの持ち主は決めない。
// - 主カテゴリがリクエストのカテゴリと一致する公演があればそれ（ページはそのまま表示する）
// - 無ければ、categories にリクエストのカテゴリを含む公演を先に、それも無ければ今の並び順の先頭
//   （ページは先に event_redirects を見て、転送が無ければこの公演の正式URLへ 308 する）
const pickMatchedEvent = <T extends { category: string; categories?: string[] | null; publish_at?: string | null }>(
  rows: T[] | null | undefined,
  category: string
) => {
  const released = (rows ?? []).filter((item) => isReleased(item.publish_at));
  return (
    released.find((item) => item.category === category) ??
    released.find(
      (item) => Array.isArray(item.categories) && item.categories.includes(category)
    ) ??
    released[0] ??
    null
  );
};

// 公演詳細の解決（候補の検索・詳細の取得）で読み取りが失敗したときは、「0件」として扱わずに例外にする。
// 0件として返すと unstable_cache にその結果が入り、ページは転送の検索・404 に進んでしまう
// （公演の検索だけが一時的に失敗し、転送の検索が成功すると、公開中の正式URLが別の公演へ 308 される）。
// 例外にすれば unstable_cache は結果を保存せず（Next 16 の unstable_cache は、関数の完了を待ってから
// 保存する）、ページは Next のエラーになる。
const throwLookupError = (what: string, error: { code?: string; message?: string }) => {
  throw new Error(`[lib/data/events] ${what}の読み込みに失敗しました（${error.code ?? "unknown"}: ${error.message ?? ""}）`);
};

const fetchEventIdBySlug = (slug: string) =>
  unstable_cache(
    async () => {
      const client = createSupabasePublicClient();
      const { data, error } = await client
        .from("events")
        .select(SLUG_LOOKUP_SELECT)
        .eq("slug", slug)
        .eq("status", "published")
        .returns<SlugCandidate[]>();
      if (error) throwLookupError("公演の候補（slug の検索）", error);
      return data ?? [];
    },
    ["event-id-by-slug", slug],
    { tags: ["events"], revalidate: 600 }
  )();

const fetchEventById = (id: string) =>
  unstable_cache(
    async () => {
      const client = createSupabasePublicClient();
      const { data, error } = await client
        .from("events")
        .select("*")
        .eq("id", id)
        .eq("status", "published")
        .maybeSingle();
      if (error) throwLookupError("公演の詳細", error);
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
      const { data, error } = await client
        .from("events")
        .select(RELATED_SELECT_FIELDS)
        .eq("category", category)
        .eq("status", "published")
        .neq("id", excludeId)
        .order("start_date", { ascending: true })
        .limit(10)
        .returns<RelatedEventSummary[]>();
      throwIfSupabaseError("related-events", error);
      const rows = data ?? [];
      return rows.filter((item) => isReleased(item.publish_at)).slice(0, 3);
    },
    ["related-events", category, excludeId],
    { tags: ["events"], revalidate: 600 }
  )();

// ---------------------------------------------------------------------------
// sitemap.xml向け（Phase 4）
// 公開＋公開日到来＋shouldNoindexでない公演の一覧。終演+7日以内（noindexの
// 猶予期間中）の公演もsitemapには含めたいため、getUpcomingEventsのようなDB側
// end_dateカットオフは使わずpublished全件を取得し、JS側でshouldNoindexだけを
// 判定する（このサイトの公演数規模では全件取得で十分安全）。
// ---------------------------------------------------------------------------

const SITEMAP_SELECT_FIELDS =
  "id, category, slug, start_date, end_date, schedule_times, publish_at, updated_at";

export type SitemapEventRow = {
  id: string;
  category: string;
  slug: string;
  start_date: string;
  end_date?: string | null;
  schedule_times?: ScheduleTimeRow[] | null;
  publish_at?: string | null;
  updated_at?: string | null;
};

const fetchSitemapEvents = async (): Promise<SitemapEventRow[]> => {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("events")
    .select(SITEMAP_SELECT_FIELDS)
    .eq("status", "published")
    .limit(1000)
    .returns<SitemapEventRow[]>();
  throwIfSupabaseError("sitemap-events", error);
  const rows = data ?? [];
  return rows.filter((event) => isReleased(event.publish_at) && !shouldNoindex(event));
};

export const getSitemapEvents = () =>
  unstable_cache(fetchSitemapEvents, ["sitemap-events"], {
    tags: ["events"],
    revalidate: 3600,
  })();

// ---------------------------------------------------------------------------
// 過去公演アーカイブ（/events/archive、Phase 4）
// 終演済み（isEnded）の公開公演を終演日時の新しい順で返す。ページネーションは
// 呼び出し側（app/events/archive/page.tsx）でsliceする。
// ---------------------------------------------------------------------------

const fetchArchivedEvents = async (): Promise<EventSummary[]> => {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("events")
    .select(UPCOMING_SELECT_FIELDS)
    .eq("status", "published")
    .order("start_date", { ascending: false })
    .limit(1000);
  throwIfSupabaseError("archived-events", error);
  const rows = (data ?? []) as EventSummary[];
  const now = new Date();
  return rows
    .filter((event) => isReleased(event.publish_at) && isEnded(event, now))
    .sort((a, b) => (getEffectiveEnd(b) ?? 0) - (getEffectiveEnd(a) ?? 0));
};

export const getArchivedEvents = () =>
  unstable_cache(fetchArchivedEvents, ["archived-events"], {
    tags: ["events"],
    revalidate: 600,
  })();
