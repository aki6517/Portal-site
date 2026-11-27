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

// 新しく作る公演の (カテゴリ, slug) の組が、ほかの公演への転送として event_redirects に
// 登録されていないかを確かめる。
// - 公開ページ（app/events/[category]/[slug]/page.tsx）は、カテゴリ（category か categories）が
//   一致する公演を event_redirects より先に選ぶ。主カテゴリだけを確かめると、categories に入れた
//   カテゴリ経由でほかの公演の旧URLを奪えるため、保存する categories（主カテゴリを含む）を全部確かめる
// - to_event_id が空の行（転送先の公演が削除済み。ON DELETE SET NULL）は、どこにも転送されない
//   ので、使われている扱いにしない
// - supabase-js の .in() は値の中の " や \ をエスケープしないので、.in() に渡すのは
//   CATEGORY_ID_PATTERN（英数字・_・-）に合う値だけにする。合わない値は1件ずつ .eq() で引く
//   （POST の値は上で形式検査済みなので、ふつうは .in() の1回だけ）
const findReservedRedirect = async (
  service: ReturnType<typeof createSupabaseServiceClient>,
  slug: string,
  categories: string[]
) => {
  const base = () =>
    service
      .from("event_redirects")
      .select("from_category, to_event_id")
      .eq("from_slug", slug);
  const safe = categories.filter((item) => CATEGORY_ID_PATTERN.test(item));
  const others = categories.filter((item) => !CATEGORY_ID_PATTERN.test(item));
  const results = await Promise.all([
    ...(safe.length > 0 ? [base().in("from_category", safe)] : []),
    ...others.map((item) => base().eq("from_category", item)),
  ]);
  const failed = results.find((result) => result.error);
  if (failed?.error) return { reserved: false, error: failed.error };
  const reserved = results.some((result) =>
    (result.data ?? []).some((row) => Boolean(row.to_event_id))
  );
  return { reserved, error: null };
};

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const resolved = await resolveActiveTheater(user.id);
  if (!resolved.activeTheaterId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Theater not onboarded" } },
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
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: eventsError.message } },
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
      { error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  let payload: EventPayload;
  try {
    payload = (await req.json()) as EventPayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
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
          message: "category, slug, title, start_date are required",
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
      { error: { code: "FORBIDDEN", message: "Theater not onboarded" } },
      { status: 403 }
    );
  }

  const { data: theater, error: theaterError } = await service
    .from("theaters")
    .select("id, name, status")
    .eq("id", resolved.activeTheaterId)
    .single();

  if (theaterError || !theater) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: theaterError?.message ?? "Theater not found",
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

  // 保存しようとしているURLが、ほかの公演の以前のURL（event_redirects）として使われていたら断る。
  // 使えてしまうと、公開ページはカテゴリが一致するこの公演を転送より先に選ぶため、
  // ほかの公演の旧URL（検索結果やSNSに残っているリンク）を奪えてしまう。
  const reservation = await findReservedRedirect(service, slug, categories);
  if (reservation.error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: reservation.error.message } },
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
    const status = createdError.code === "23505" ? 409 : 500;
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: createdError.message,
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
