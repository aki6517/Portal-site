import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveActiveTheater } from "@/lib/theater/activeTheater";
import { resolveVenue, type VenueRow } from "@/lib/venues/normalize";
import {
  EVENT_SLUG_ERROR_MESSAGES,
  validateEventSlug,
} from "@/lib/event-slug";

type EventPayload = {
  category?: string;
  categories?: string[];
  slug?: string;
  title?: string;
  description?: string | null;
  playwright?: string | null;
  director?: string | null;
  publish_at?: string | null;
  start_date?: string;
  end_date?: string | null;
  reservation_start_at?: string | null;
  reservation_label?: string | null;
  reservation_links?: { label?: string; url?: string }[] | null;
  schedule_times?: { start_date?: string; end_date?: string | null; label?: string }[];
  venue_id?: string | null;
  venue?: string | null;
  venue_address?: string | null;
  venue_lat?: number | null;
  venue_lng?: number | null;
  price_general?: number | null;
  price_student?: number | null;
  ticket_types?: { label?: string; price?: number | null; note?: string }[] | null;
  tags?: string[] | string | null;
  image_url?: string | null;
  flyer_url?: string | null;
  analysis_flyer_url?: string | null;
  ticket_url?: string | null;
  cast?: unknown[] | null;
  ai_confidence?: number | null;
  status?: "draft" | "published" | "archived";
};

// 劇団が承認済み（approved）でないときに、公開（published）での作成を断るメッセージ。
// EventForm は応答の error.message をそのまま表示する。
const THEATER_NOT_APPROVED_MESSAGE =
  "劇団の登録が承認済みではないため、公演を公開できません。下書きとして保存するか、福岡アクトポータル運営にお問い合わせください。";

// 保存しようとしている公演のURL（/events/{category}/{slug}）が、ほかの公演の以前のURL
// （event_redirects）として使われているときに、保存を断るメッセージ。
// EventForm は応答の error.message をそのまま表示する。
const SLUG_RESERVED_MESSAGE =
  "このURLは、ほかの公演の以前のURLとして使われているため使えません。別の英字にしてください。";

// 劇団向けの画面（EventForm・公演一覧など）は応答の error.message をそのまま表示するので、
// message は劇団の人が読んで次に何をすればいいか分かる日本語にする（error.code と HTTP ステータスは
// 機械が読む値なので変えない）。DB のエラー文は応答に出さず、サーバーのログに残す（logDbError）。
const LOGIN_REQUIRED_MESSAGE =
  "ログインが必要です。ログインし直してから、もう一度お試しください。";
const INVALID_BODY_MESSAGE =
  "送られた内容を読み取れませんでした。画面を読み込み直してから、もう一度お試しください。";
const THEATER_NOT_REGISTERED_MESSAGE =
  "劇団の登録がまだ済んでいません。劇団の情報を登録してから、もう一度お試しください。";
const REQUIRED_FIELDS_MESSAGE =
  "カテゴリ・公演ページのURLに使う英字・公演タイトル・公演日を入力してください。";
const THEATER_NOT_FOUND_MESSAGE =
  "劇団の情報が見つかりませんでした。画面を読み込み直してから、もう一度お試しください。";
const URL_TAKEN_MESSAGE =
  "このURL（英字）は、ほかの公演がすでに使っています。別の英字にしてください。";
const CATEGORY_NOT_FOUND_MESSAGE =
  "選んだカテゴリが見つかりませんでした。カテゴリを選び直してください。";
const VENUE_NOT_FOUND_MESSAGE =
  "指定した会場が見つかりませんでした。会場名を入力し直してください。";
const REFERENCE_NOT_FOUND_MESSAGE =
  "入力した項目のうち、見つからないものがありました。入力内容を確かめてから、もう一度お試しください。";
const SAVE_FAILED_MESSAGE =
  "保存に失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const FIELD_TYPE_MESSAGE =
  "入力内容の形が正しくありません。画面を読み込み直してから、もう一度お試しください。";
const LOAD_FAILED_MESSAGE =
  "読み込みに失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";

type DbErrorLike = { code?: string; message?: string; details?: string | null } | null | undefined;

// DB のエラーの code・message は、応答に出さずサーバーのログに残す。
// details・hint はログにも残さない（チェック制約違反の「Failing row contains (...)」のように、
// 行の中身が入ることがあるため）。
const logDbError = (context: string, error: DbErrorLike) => {
  console.error(`[api/theater/events] ${context}`, {
    code: error?.code,
    message: error?.message,
  });
};

// events への保存（insert）の DB エラーを、劇団の人が読む日本語の文にする。
// - 23505（一意制約）: message か details に uniq_events_category_slug（(category, slug) の一意制約。
//   docs/sql/001_init.sql）があるときだけ URL のぶつかり。それ以外の一意制約は「保存に失敗しました」
// - 23503（外部キー）: details の「Key (列名)=…」か制約名から、見つからないものを言い分ける
// - それ以外: 決まった「保存に失敗しました」
const describeEventWriteError = (error: DbErrorLike) => {
  if (error?.code === "23505") {
    // URL（category, slug）の一意制約のときだけ「URLが使われている」。ほかの一意制約は決まった文にする
    const text = `${error.message ?? ""} ${error.details ?? ""}`;
    return text.includes("uniq_events_category_slug") ? URL_TAKEN_MESSAGE : SAVE_FAILED_MESSAGE;
  }
  if (error?.code === "23503") {
    const text = `${error.details ?? ""} ${error.message ?? ""}`;
    if (/\(category\)|events_category_fkey/.test(text)) return CATEGORY_NOT_FOUND_MESSAGE;
    if (/\(venue_id\)|events_venue_id_fkey/.test(text)) return VENUE_NOT_FOUND_MESSAGE;
    if (/\(theater_id\)|events_theater_id_fkey/.test(text)) return THEATER_NOT_FOUND_MESSAGE;
    return REFERENCE_NOT_FOUND_MESSAGE;
  }
  return SAVE_FAILED_MESSAGE;
};

// カテゴリID（categories 表の id）の形式。docs/sql の categories 表の id は TEXT で形式の制約は無く、
// 入っている値（comedy・drama など）はすべて英小文字。公開ページの絞り込み
// （lib/data/events.ts の sanitizeCategoryValue）が安全とみなす文字（英数字・_・-）に合わせ、
// 長さは 64 文字までにする。
const CATEGORY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const CATEGORY_FORMAT_MESSAGE =
  "カテゴリの指定が正しくありません。カテゴリを選び直してください。";

// category・categories の型と形式を確かめ、trim した値を返す。
// - category: 無い（undefined・null）は undefined。文字列以外・形式に合わない値は不正
// - categories: 無い（undefined・null）は undefined。配列以外は不正。要素は文字列以外なら不正、
//   trim して空なら今までどおり捨てる、空でなく形式に合わなければ不正
const parseCategoryInput = (
  rawCategory: unknown,
  rawCategories: unknown
):
  | { ok: true; category: string | undefined; categories: string[] | undefined }
  | { ok: false } => {
  let category: string | undefined;
  if (rawCategory !== undefined && rawCategory !== null) {
    if (typeof rawCategory !== "string") return { ok: false };
    category = rawCategory.trim();
    if (category && !CATEGORY_ID_PATTERN.test(category)) return { ok: false };
  }
  let categories: string[] | undefined;
  if (rawCategories !== undefined && rawCategories !== null) {
    if (!Array.isArray(rawCategories)) return { ok: false };
    categories = [];
    for (const item of rawCategories) {
      if (typeof item !== "string") return { ok: false };
      const trimmed = item.trim();
      if (!trimmed) continue;
      if (!CATEGORY_ID_PATTERN.test(trimmed)) return { ok: false };
      categories.push(trimmed);
    }
  }
  return { ok: true, category, categories };
};

// 本文が普通のオブジェクト（JSON の null・配列・文字列などではない）か。違うと payload.xxx で例外（500）になる
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
// 無い（undefined・null）か文字列か。数値などだと trim() で例外（500）になる
const isOptionalString = (value: unknown) =>
  value === undefined || value === null || typeof value === "string";

const isOptionalNumber = (value: unknown) =>
  value === undefined || value === null || (typeof value === "number" && Number.isFinite(value));
const isOptionalArrayOf = (value: unknown, check: (item: unknown) => boolean) =>
  value === undefined || value === null || (Array.isArray(value) && value.every(check));
const EVENT_STRING_FIELDS = [
  "title",
  "description",
  "playwright",
  "director",
  "publish_at",
  "start_date",
  "end_date",
  "reservation_start_at",
  "reservation_label",
  "venue_id",
  "venue",
  "venue_address",
  "image_url",
  "flyer_url",
  "analysis_flyer_url",
  "ticket_url",
] as const;
const EVENT_NUMBER_FIELDS = [
  "venue_lat",
  "venue_lng",
  "price_general",
  "price_student",
  "ai_confidence",
] as const;
// price_general・price_student は events の INTEGER 列（docs/sql/001_init.sql）。小数・負の数・integer を超える数を
// 送ると DB で保存に失敗（500）するので、0 以上の整数で integer の範囲（2147483647 まで）か、null・未指定だけを通す。
const PRICE_FORMAT_MESSAGE = "料金は円単位の整数（例：3000）で入力してください。";
const MAX_INTEGER_COLUMN = 2147483647;
const isValidPrice = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_INTEGER_COLUMN);
const EVENT_STATUSES = new Set(["draft", "published", "archived"]);
// 公演の保存で読む項目の型を確かめる（category・categories・slug・superseded_by は別に確かめる）。
// 型が違うと trim() などで例外（500）になったり、DB の型の違いで保存に失敗したりするため、先に 400 にする。
// EventForm が送る形（文字列・数値か null・決まった形のオブジェクトの配列）はすべて通る。
const hasInvalidEventField = (payload: Record<string, unknown>) =>
  EVENT_STRING_FIELDS.some((key) => !isOptionalString(payload[key])) ||
  EVENT_NUMBER_FIELDS.some((key) => !isOptionalNumber(payload[key])) ||
  !(
    payload.status === undefined ||
    payload.status === null ||
    (typeof payload.status === "string" && EVENT_STATUSES.has(payload.status))
  ) ||
  !isOptionalArrayOf(
    payload.schedule_times,
    (item) =>
      isPlainObject(item) &&
      isOptionalString(item.start_date) &&
      isOptionalString(item.end_date) &&
      isOptionalString(item.label)
  ) ||
  !isOptionalArrayOf(
    payload.reservation_links,
    (item) => isPlainObject(item) && isOptionalString(item.label) && isOptionalString(item.url)
  ) ||
  !isOptionalArrayOf(
    payload.ticket_types,
    (item) =>
      isPlainObject(item) &&
      isOptionalString(item.label) &&
      isOptionalNumber(item.price) &&
      isOptionalString(item.note)
  ) ||
  !(
    payload.tags === undefined ||
    payload.tags === null ||
    typeof payload.tags === "string" ||
    (Array.isArray(payload.tags) && payload.tags.every((tag) => typeof tag === "string"))
  ) ||
  !isOptionalArrayOf(
    payload.cast,
    (item) =>
      typeof item === "string" ||
      (isPlainObject(item) &&
        isOptionalString(item.name) &&
        isOptionalString(item.role) &&
        isOptionalString(item.image_url))
  );

const normalizeTags = (tags?: string[] | string | null) => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter(Boolean);
  return tags
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
};

const normalizeCategories = (categories?: string[] | null, primary?: string) => {
  const list = Array.isArray(categories) ? categories : [];
  const merged = [
    ...(primary ? [primary] : []),
    ...list.map((item) => item.trim()),
  ].filter(Boolean);
  return Array.from(new Set(merged));
};

const normalizeScheduleTimes = (
  scheduleTimes?: { start_date?: string; end_date?: string | null; label?: string }[]
) => {
  if (!Array.isArray(scheduleTimes)) return [];
  return scheduleTimes
    .map((item) => ({
      start_date: (item.start_date ?? "").trim(),
      end_date: item.end_date ? item.end_date.trim() : null,
      label: item.label?.trim() ?? "",
    }))
    .filter((item) => item.start_date);
};

const normalizeReservationLinks = (
  links?: { label?: string; url?: string }[] | null
) => {
  if (!Array.isArray(links)) return [];
  return links
    .map((item) => ({
      label: item.label?.trim() ?? "",
      url: item.url?.trim() ?? "",
    }))
    .filter((item) => item.label || item.url);
};

const normalizeOptionalText = (value?: string | null) => {
  const text = value?.trim() ?? "";
  return text || null;
};

const parseMissingColumn = (message?: string | null) => {
  if (!message) return null;
  const patterns = [
    /["']([a-zA-Z0-9_]+)["']\s+column/i,
    /\bcolumn\s+["']([a-zA-Z0-9_]+)["']/i,
    /\bcolumn\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\s+does\s+not\s+exist/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
};

const deriveDateRange = (
  scheduleTimes: { start_date: string; end_date: string | null }[],
  fallbackStart?: string,
  fallbackEnd?: string | null
) => {
  if (scheduleTimes.length === 0) {
    return {
      start: fallbackStart,
      end: fallbackEnd ?? null,
    };
  }
  const starts = scheduleTimes.map((item) => item.start_date).sort();
  const ends = scheduleTimes
    .map((item) => item.end_date)
    .filter(Boolean)
    .sort() as string[];
  return {
    start: starts[0],
    end: ends.length > 0 ? ends[ends.length - 1] : fallbackEnd ?? null,
  };
};

// venue文字列からvenuesテーブルを引いてvenue_idを解決する（ベストエフォート）。
// venuesの取得に失敗しても公演の保存自体は止めない（venue_id: nullのまま保存）。
// select("*")にしているのはdocs/sql/009_venues_area.sql未適用のDBでも
// aliases列エラーにならないようにするため（lib/venues/normalizeのresolveVenueは
// aliasesが無くても動く）。
const resolveVenueId = async (
  venueText: string | null | undefined,
  service: ReturnType<typeof createSupabaseServiceClient>
): Promise<string | null> => {
  const text = (venueText ?? "").trim();
  if (!text) return null;
  try {
    const { data } = await service.from("venues").select("*");
    return resolveVenue(text, (data ?? []) as VenueRow[]).venueId;
  } catch {
    return null;
  }
};

// 新しく作る公演の主カテゴリの組 (category, slug) が、ほかの公演への転送として event_redirects に
// 登録されていないかを確かめる。
// - 公演のURLは /events/{主カテゴリ}/{slug} の1つだけ。categories（2つ目からのカテゴリ）はURLを持たない
//   タグで、公開ページも categories の一致より転送を先に見るので、categories の組は確かめない
// - to_event_id が空の行（転送先の公演が削除済み。ON DELETE SET NULL）は、どこにも転送されない
//   ので、使われている扱いにしない
const findReservedRedirect = async (
  service: ReturnType<typeof createSupabaseServiceClient>,
  category: string,
  slug: string
) => {
  const { data, error } = await service
    .from("event_redirects")
    .select("to_event_id")
    .eq("from_category", category)
    .eq("from_slug", slug)
    .maybeSingle();
  if (error) return { reserved: false, error };
  return { reserved: Boolean(data?.to_event_id), error: null };
};

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: LOGIN_REQUIRED_MESSAGE } },
      { status: 401 }
    );
  }

  const resolved = await resolveActiveTheater(user.id);
  if (!resolved.activeTheaterId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: THEATER_NOT_REGISTERED_MESSAGE } },
      { status: 403 }
    );
  }

  let { data: events, error: eventsError } = await supabase
    .from("events")
    .select(
      "id, title, slug, category, categories, status, start_date, end_date, updated_at"
    )
    .eq("theater_id", resolved.activeTheaterId)
    .order("updated_at", { ascending: false });

  const missingColumns =
    !!eventsError &&
    (eventsError.message.includes("column") ||
      eventsError.message.includes("does not exist"));
  if (missingColumns) {
    const fallback = await supabase
      .from("events")
      .select("id, title, slug, category, status, start_date, end_date, updated_at")
      .eq("theater_id", resolved.activeTheaterId)
      .order("updated_at", { ascending: false });
    events =
      fallback.data?.map((event) => ({
        ...event,
        categories: event.category ? [event.category] : [],
      })) ?? null;
    eventsError = fallback.error;
  }

  if (eventsError) {
    logDbError("GET: events の読み込みに失敗", eventsError);
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: LOAD_FAILED_MESSAGE } },
      { status: 500 }
    );
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !events || events.length === 0) {
    return NextResponse.json({ data: { events } });
  }

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceDate = since.toISOString().slice(0, 10);
  const eventIds = events.map((event) => event.id);
  const service = createSupabaseServiceClient();
  const { data: viewsRows } = await service
    .from("event_views_daily")
    .select("event_id, views")
    .gte("view_date", sinceDate)
    .in("event_id", eventIds);

  const viewsMap = new Map<string, number>();
  (viewsRows ?? []).forEach((row) => {
    const total = viewsMap.get(row.event_id) ?? 0;
    viewsMap.set(row.event_id, total + (row.views ?? 0));
  });

  const eventsWithViews = events.map((event) => ({
    ...event,
    views_30: viewsMap.get(event.id) ?? 0,
  }));

  return NextResponse.json({ data: { events: eventsWithViews } });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const service = createSupabaseServiceClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: LOGIN_REQUIRED_MESSAGE } },
      { status: 401 }
    );
  }

  let payload: EventPayload;
  try {
    payload = (await req.json()) as EventPayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: INVALID_BODY_MESSAGE } },
      { status: 400 }
    );
  }

  if (!isPlainObject(payload)) {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: INVALID_BODY_MESSAGE } },
      { status: 400 }
    );
  }

  // slugが文字列以外（数値・オブジェクト・true など）だと下の trim() で例外になるため
  // 先に400で返す。無い（undefined・null）・空のときは、下の既存の必須チェックに任せる。
  const rawSlug: unknown = payload.slug;
  if (rawSlug !== undefined && rawSlug !== null && typeof rawSlug !== "string") {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: EVENT_SLUG_ERROR_MESSAGES.format,
        },
      },
      { status: 400 }
    );
  }

  // category・categories が文字列以外（数値・null の要素など）だと下の trim() で例外（500）になり、
  // 形式外の値は event_redirects の確認にもそのまま渡るため、先に400で返す。
  // category が無い・空のときは、下の既存の必須チェックに任せる。
  const categoryInput = parseCategoryInput(payload.category, payload.categories);
  if (!categoryInput.ok) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: CATEGORY_FORMAT_MESSAGE,
        },
      },
      { status: 400 }
    );
  }
  if (!isValidPrice(payload.price_general) || !isValidPrice(payload.price_student)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: PRICE_FORMAT_MESSAGE } },
      { status: 400 }
    );
  }
  if (hasInvalidEventField(payload)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: FIELD_TYPE_MESSAGE } },
      { status: 400 }
    );
  }

  const category = categoryInput.category ?? "";
  const categories = normalizeCategories(categoryInput.categories ?? null, category);
  const slug = payload.slug?.trim();
  const title = payload.title?.trim();
  const playwright = normalizeOptionalText(payload.playwright);
  const director = normalizeOptionalText(payload.director);
  const scheduleTimes = normalizeScheduleTimes(payload.schedule_times);
  const reservationLinks = normalizeReservationLinks(payload.reservation_links);
  const derivedDates = deriveDateRange(
    scheduleTimes,
    payload.start_date,
    payload.end_date ?? null
  );
  const startDate = derivedDates.start;
  const endDate = derivedDates.end;

  if (!category || !slug || !title || !startDate) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: REQUIRED_FIELDS_MESSAGE,
        },
      },
      { status: 400 }
    );
  }

  // slugは公開URL（/events/{category}/{slug}）とサイトマップにそのまま使われる。
  // 公式サイトのURLなどが入らないよう、EventFormと同じ関数で形式を検査する。
  const slugValidation = validateEventSlug(slug);
  if (!slugValidation.ok) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: slugValidation.message,
        },
      },
      { status: 400 }
    );
  }

  const resolved = await resolveActiveTheater(user.id);
  if (!resolved.activeTheaterId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: THEATER_NOT_REGISTERED_MESSAGE } },
      { status: 403 }
    );
  }

  const { data: theater, error: theaterError } = await service
    .from("theaters")
    .select("id, name, status")
    .eq("id", resolved.activeTheaterId)
    .single();

  if (theaterError || !theater) {
    if (theaterError) logDbError("POST: theaters の読み込みに失敗", theaterError);
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: theaterError ? SAVE_FAILED_MESSAGE : THEATER_NOT_FOUND_MESSAGE,
        },
      },
      { status: 500 }
    );
  }

  // published での作成は、承認済み（approved）の劇団だけに許可する
  // （docs/04_api.md「4. 劇団向け 公演CRUD」）。見るのは insert 先の劇団
  // （下の theater_id に入れる theater.id ＝ resolveActiveTheater で決めた劇団）の status。
  // draft（既定値）・archived での作成は、劇団の status に関係なく今までどおり許可する。
  const insertStatus = payload.status ?? "draft";
  if (insertStatus === "published" && theater.status !== "approved") {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: THEATER_NOT_APPROVED_MESSAGE,
        },
      },
      { status: 403 }
    );
  }

  // 保存しようとしているURL（主カテゴリの組）が、ほかの公演の以前のURL（event_redirects）として
  // 使われていたら断る。使えてしまうと、公開ページは主カテゴリが一致するこの公演を転送より先に
  // 表示するため、ほかの公演の旧URL（検索結果やSNSに残っているリンク）を奪えてしまう。
  const reservation = await findReservedRedirect(service, category, slug);
  if (reservation.error) {
    logDbError("POST: event_redirects の読み込みに失敗", reservation.error);
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: SAVE_FAILED_MESSAGE } },
      { status: 500 }
    );
  }
  if (reservation.reserved) {
    return NextResponse.json(
      { error: { code: "SLUG_RESERVED", message: SLUG_RESERVED_MESSAGE } },
      { status: 409 }
    );
  }

  // venue_idが明示的に送られていればそれを優先し、無ければvenue文字列から
  // 自動解決する（EventFormはvenue_idを送らないため、通常はここで解決される）。
  const resolvedVenueId = payload.venue_id
    ? payload.venue_id
    : await resolveVenueId(payload.venue, service);

  const insertPayload: Record<string, unknown> = {
    theater_id: theater.id,
    category,
    slug,
    title,
    company: theater.name,
    description: payload.description ?? null,
    playwright,
    director,
    publish_at: payload.publish_at ?? null,
    start_date: startDate,
    end_date: endDate ?? null,
    reservation_start_at: payload.reservation_start_at ?? null,
    reservation_label: payload.reservation_label ?? null,
    reservation_links: reservationLinks,
    schedule_times: scheduleTimes,
    venue_id: resolvedVenueId,
    venue: payload.venue ?? null,
    venue_address: payload.venue_address ?? null,
    venue_lat: payload.venue_lat ?? null,
    venue_lng: payload.venue_lng ?? null,
    price_general: payload.price_general ?? null,
    price_student: payload.price_student ?? null,
    ticket_types: payload.ticket_types ?? [],
    tags: normalizeTags(payload.tags),
    image_url: payload.image_url ?? null,
    flyer_url: payload.flyer_url ?? null,
    analysis_flyer_url: payload.analysis_flyer_url ?? null,
    ticket_url: payload.ticket_url ?? null,
    "cast": payload.cast ?? [],
    ai_confidence:
      payload.ai_confidence !== undefined ? payload.ai_confidence : null,
    status: insertStatus,
    categories,
  };

  const { data: event, error: insertError } = await service
    .from("events")
    .insert(insertPayload)
    .select("id, category, slug, status")
    .single();

  let createdEvent = event;
  let createdError = insertError;
  const missingColumns =
    !!createdError &&
    (createdError.message.includes("column") ||
      createdError.message.includes("does not exist"));

  if (missingColumns) {
    const retryPayload: Record<string, unknown> = { ...insertPayload };
    let retries = 0;
    while (createdError && retries < 12) {
      const missingColumn = parseMissingColumn(createdError.message);
      if (!missingColumn || !(missingColumn in retryPayload)) break;
      delete retryPayload[missingColumn];
      const retry = await service
        .from("events")
        .insert(retryPayload)
        .select("id, category, slug, status")
        .single();
      createdEvent = retry.data;
      createdError = retry.error;
      retries += 1;
    }
  }

  if (createdError) {
    logDbError("POST: events の作成に失敗", createdError);
    const status = createdError.code === "23505" ? 409 : 500;
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: describeEventWriteError(createdError),
        },
      },
      { status }
    );
  }

  if (createdEvent?.id) {
    // 第2引数はNext.js 16で必須化されたcacheLifeプロファイル。
    // { expire: 0 } を渡すと無条件・即時のフル再検証になる（保存→即反映を維持するため）。
    revalidateTag("events", { expire: 0 });
    revalidateTag(`event:${createdEvent.id}`, { expire: 0 });
  }

  return NextResponse.json({ data: { event: createdEvent } }, { status: 201 });
}
