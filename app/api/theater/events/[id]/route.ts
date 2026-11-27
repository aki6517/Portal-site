import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveActiveTheater } from "@/lib/theater/activeTheater";
import { resolveVenue, type VenueRow } from "@/lib/venues/normalize";
import {
  EVENT_SLUG_ERROR_MESSAGES,
  validateEventSlug,
} from "@/lib/event-slug";

type EventUpdatePayload = {
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
  superseded_by?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 劇団が承認済み（approved）でないときに、published への変更を断るメッセージ。
// EventForm・EditEventScreen は応答の error.message をそのまま表示する。
const THEATER_NOT_APPROVED_MESSAGE =
  "劇団の登録が承認済みではないため、公演を公開できません。下書きとして保存するか、福岡アクトポータル運営にお問い合わせください。";

// 保存しようとしている公演のURL（/events/{category}/{slug}）が、ほかの公演の以前のURL
// （event_redirects）として使われているときに、保存を断るメッセージ。
// EventForm は応答の error.message をそのまま表示する。
const SLUG_RESERVED_MESSAGE =
  "このURLは、ほかの公演の以前のURLとして使われているため使えません。別の英字にしてください。";

// 保存後の (category, slug) を別の公演がすでに使っているときの message。更新が events の一意制約
// （docs/sql/001_init.sql の uniq_events_category_slug）にぶつかったときに PostgREST が返す message と
// 同じにして、今までの 409（code: "DB_ERROR"）と同じ応答にする。
const EVENT_URL_TAKEN_MESSAGE =
  'duplicate key value violates unique constraint "uniq_events_category_slug"';

// カテゴリID（categories 表の id）の形式。docs/sql の categories 表の id は TEXT で形式の制約は無く、
// 入っている値（comedy・drama など）はすべて英小文字。公開ページの絞り込み
// （lib/data/events.ts の sanitizeCategoryValue）が安全とみなす文字（英数字・_・-）に合わせ、
// 長さは 64 文字までにする。app/api/theater/events/route.ts と同じ。
const CATEGORY_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const CATEGORY_FORMAT_MESSAGE =
  "カテゴリの指定が正しくありません。カテゴリを選び直してください。";

// category・categories の型と形式を確かめ、trim した値を返す（app/api/theater/events/route.ts と同じ）。
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
  if (!tags) return undefined;
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
  if (!Array.isArray(scheduleTimes)) return undefined;
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
  if (!Array.isArray(links)) return undefined;
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
// venuesの取得に失敗しても公演の保存自体は止めない（venue_id: nullのまま更新）。
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

// 公開ページで、この公演が一致するカテゴリの一覧（主カテゴリ＋categories）。
// lib/data/events.ts の matchesEventCategory と同じく、保存されている値のまま比べる。
const toCategorySet = (primary: unknown, categories: unknown) => {
  const list = [primary, ...(Array.isArray(categories) ? categories : [])];
  return Array.from(
    new Set(
      list.filter((item): item is string => typeof item === "string" && item.length > 0)
    )
  );
};

// 保存しようとしている (カテゴリ, slug) の組が、ほかの公演への転送として event_redirects に
// 登録されていないかを確かめる。
// - 公開ページ（app/events/[category]/[slug]/page.tsx）は、カテゴリ（category か categories）が
//   一致する公演を event_redirects より先に選ぶ。主カテゴリだけを確かめると、categories に入れた
//   カテゴリ経由でほかの公演の旧URLを奪えるため、categories のカテゴリも確かめる
// - to_event_id が空の行（転送先の公演が削除済み。ON DELETE SET NULL）は、どこにも転送されない
//   ので、使われている扱いにしない
// - selfId（この公演）への転送は、自分の旧URLに戻すだけなので許可する
// - supabase-js の .in() は値の中の " や \ をエスケープしないので、.in() に渡すのは
//   CATEGORY_ID_PATTERN（英数字・_・-）に合う値だけにする。合わない値は1件ずつ .eq() で引く
//   （保存前の categories は DB の値で、この要求の形式検査を通っていないことがあるため）
const findReservedRedirect = async (
  service: ReturnType<typeof createSupabaseServiceClient>,
  slug: string,
  categories: string[],
  selfId: string
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
    (result.data ?? []).some(
      (row) => Boolean(row.to_event_id) && row.to_event_id !== selfId
    )
  );
  return { reserved, error: null };
};

// この公演の旧URL（保存前の (カテゴリ, slug) の組）を、この公演への転送として event_redirects に登録する。
// ほかの公演への転送として登録済みの組は上書きしない（その公演の旧URLを奪わないため）。
// - 未登録: 登録する。ON CONFLICT DO NOTHING（ignoreDuplicates）で入れるので、確かめてから
//   書くまでの間にほかの保存が同じ組を登録していても、そちらを残す
// - 転送先が空（転送先の公演が削除済み。ON DELETE SET NULL）: この公演に向け直す。
//   to_event_id が空のままの行だけを書き換えるので、その間にほかの公演へ向いた行は上書きしない
// - この公演への転送・ほかの公演への転送: そのまま
// 読み書きが DB エラーなら error を返す（呼び出し元は 500 にして events を更新しない）。
const registerOldUrlRedirect = async (
  service: ReturnType<typeof createSupabaseServiceClient>,
  fromCategory: string,
  fromSlug: string,
  eventId: string
): Promise<{ error: { message: string } | null }> => {
  const { data: existing, error } = await service
    .from("event_redirects")
    .select("to_event_id")
    .eq("from_category", fromCategory)
    .eq("from_slug", fromSlug)
    .maybeSingle();
  if (error) return { error };
  if (!existing) {
    const { error: insertError } = await service.from("event_redirects").upsert(
      {
        from_category: fromCategory,
        from_slug: fromSlug,
        to_event_id: eventId,
      },
      { onConflict: "from_category,from_slug", ignoreDuplicates: true }
    );
    return { error: insertError ?? null };
  }
  if (existing.to_event_id === null) {
    const { error: repointError } = await service
      .from("event_redirects")
      .update({ to_event_id: eventId })
      .eq("from_category", fromCategory)
      .eq("from_slug", fromSlug)
      .is("to_event_id", null);
    return { error: repointError ?? null };
  }
  return { error: null };
};

// この状態（status・publish_at）の公演が、公開ページで一般に見られるか。保存前と保存後の両方に使う。
// 公開ページ（lib/data/events.ts の fetchEventIdBySlug・fetchEventById・isReleased）が出すのは、
// status が published で、publish_at が空か今より前（日付として読めない値も公開扱い）の公演だけ。
// draft・archived と、公開日前の published は出ない。終演後でも published のままなら出る。
const isPubliclyVisible = (event: { status?: string | null; publish_at?: string | null }) => {
  if (event.status !== "published") return false;
  if (!event.publish_at) return true;
  const time = new Date(event.publish_at).getTime();
  if (Number.isNaN(time)) return true;
  return time <= Date.now();
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .eq("theater_id", resolved.activeTheaterId)
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Event not found" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: { event } });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  let payload: EventUpdatePayload;
  try {
    payload = (await req.json()) as EventUpdatePayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
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

  const { data: theater } = await service
    .from("theaters")
    .select("id, status")
    .eq("id", resolved.activeTheaterId)
    .single();

  if (!theater) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: "Theater not found" } },
      { status: 500 }
    );
  }

  // publish_at は「保存前のURLが一般に見られる状態だったか」（旧URLを登録するか）の判定に使う。
  // 下の列が無いDB向けの読み直しには入れない（publish_at 列も無いDBで 404 にしないため。
  // その場合 publish_at は undefined ＝公開日の指定なしとして扱われる）。
  let { data: current, error: currentError } = await service
    .from("events")
    .select("id, category, slug, status, start_date, end_date, categories, publish_at")
    .eq("id", id)
    .eq("theater_id", resolved.activeTheaterId)
    .single();

  const missingCurrentColumns =
    !!currentError &&
    (currentError.message.includes("column") ||
      currentError.message.includes("does not exist"));
  if (missingCurrentColumns) {
    const fallbackCurrent = await service
      .from("events")
      .select("id, category, slug, status, start_date, end_date")
      .eq("id", id)
      .eq("theater_id", resolved.activeTheaterId)
      .single();
    current = fallbackCurrent.data as typeof current;
    currentError = fallbackCurrent.error;
  }

  if (currentError || !current) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Event not found" } },
      { status: 404 }
    );
  }

  // slug: キーが無ければ現状維持。送られてきたら文字列以外は400。
  // 現在値と完全に同じなら形式検査をせず、更新にも含めない（同じ値を書き戻さない）。
  //  - 過去の公演に残る形式外のスラッグ（百年桃・mime_faust など）のままでも、
  //    劇団がほかの項目を編集できるようにするため（EventFormの編集時の扱いと同じ）
  //  - 同時編集で、ほかの人が直したスラッグを古い値で上書きしないため
  // 違う値のときだけ trim → 形式検査 → 更新に入れる（"" や " " も400）。
  let slugUpdate: string | undefined;
  if (payload.slug !== undefined) {
    const rawSlug: unknown = payload.slug;
    if (typeof rawSlug !== "string") {
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
    if (rawSlug !== current.slug) {
      const slugValidation = validateEventSlug(rawSlug);
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
      // trimした結果が現在値と同じなら、書き戻さない
      if (slugValidation.slug !== current.slug) {
        slugUpdate = slugValidation.slug;
      }
    }
  }

  // category・categories: 文字列以外（数値・null の要素など）だと trim() で例外（500）になり、
  // 形式外の値は event_redirects の確認にもそのまま渡るため、400で返す。
  // category を送ったのに空（"" や " "）のときも400（そのまま保存すると空のカテゴリになるため）。
  // category を送らない・null のときは今までどおり categories の先頭か現在値を使う。
  const categoryInput = parseCategoryInput(payload.category, payload.categories);
  if (!categoryInput.ok || categoryInput.category === "") {
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

  // superseded_by（再演時の後継公演指定）: UUID形式・自分自身でないこと・
  // 同じ劇団（theater_id）の公演であることをserviceクライアントで検証する。
  // undefinedのまま＝ペイロードに無ければ更新しない（他フィールドと同じ規約）。
  let supersededByUpdate: string | null | undefined;
  if ("superseded_by" in payload) {
    const raw = payload.superseded_by;
    if (raw === null || raw === "") {
      supersededByUpdate = null;
    } else if (typeof raw !== "string" || !UUID_PATTERN.test(raw)) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "superseded_by must be a valid UUID",
          },
        },
        { status: 400 }
      );
    } else if (raw === id) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "superseded_by cannot reference itself",
          },
        },
        { status: 400 }
      );
    } else {
      const { data: supersededTarget } = await service
        .from("events")
        .select("id")
        .eq("id", raw)
        .eq("theater_id", resolved.activeTheaterId)
        .maybeSingle();
      if (!supersededTarget) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "superseded_by must reference an event owned by the same theater",
            },
          },
          { status: 400 }
        );
      }
      supersededByUpdate = raw;
    }
  }

  // published への変更は、承認済み（approved）の劇団だけに許可する
  // （docs/04_api.md「4. 劇団向け 公演CRUD」）。見るのは対象公演が属する劇団の status。
  // current は theater_id = resolved.activeTheaterId で引いているので、同じ id で引いた
  // theater が対象公演の劇団になる。
  // status を送らない編集や draft / archived への変更は、停止中などの劇団でも今までどおり
  // 許可する（公開をやめる操作や下書きの編集はできるようにするため）。
  // 公開中の公演を status: "published" のまま保存する場合も、送られた status が
  // published なので 403 になる（EventForm は保存のたびに status を送る）。
  if (payload.status === "published" && theater.status !== "approved") {
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

  const update: Record<string, unknown> = {};
  const incomingCategory = categoryInput.category;
  const hasCategories = "categories" in payload;
  const hasCategory = "category" in payload;
  if (hasCategories || hasCategory) {
    const primary =
      incomingCategory ?? categoryInput.categories?.[0] ?? current.category;
    const normalized = normalizeCategories(categoryInput.categories ?? null, primary);
    update.category = primary;
    update.categories = normalized;
  }
  if (slugUpdate !== undefined) update.slug = slugUpdate;
  if (payload.title) update.title = payload.title.trim();
  if ("description" in payload) update.description = payload.description ?? null;
  if ("playwright" in payload) {
    update.playwright = normalizeOptionalText(payload.playwright);
  }
  if ("director" in payload) {
    update.director = normalizeOptionalText(payload.director);
  }
  if ("publish_at" in payload) update.publish_at = payload.publish_at ?? null;
  const scheduleTimes =
    "schedule_times" in payload
      ? normalizeScheduleTimes(payload.schedule_times) ?? []
      : undefined;
  if (scheduleTimes) {
    update.schedule_times = scheduleTimes;
    const derived = deriveDateRange(
      scheduleTimes,
      payload.start_date ?? current.start_date,
      "end_date" in payload ? payload.end_date ?? null : current.end_date
    );
    update.start_date = derived.start;
    update.end_date = derived.end;
  } else {
    if (payload.start_date) update.start_date = payload.start_date;
    if ("end_date" in payload) update.end_date = payload.end_date ?? null;
  }
  if ("reservation_start_at" in payload) {
    update.reservation_start_at = payload.reservation_start_at ?? null;
  }
  if ("reservation_label" in payload) {
    update.reservation_label = payload.reservation_label ?? null;
  }
  if ("reservation_links" in payload) {
    update.reservation_links = normalizeReservationLinks(payload.reservation_links) ?? [];
  }
  if ("venue_id" in payload) {
    update.venue_id = payload.venue_id ?? null;
  } else if ("venue" in payload) {
    // venue_idが明示されない保存（EventFormの通常フロー）はvenue文字列から自動解決する
    update.venue_id = await resolveVenueId(payload.venue, service);
  }
  if ("venue" in payload) update.venue = payload.venue ?? null;
  if ("venue_address" in payload)
    update.venue_address = payload.venue_address ?? null;
  if ("venue_lat" in payload) update.venue_lat = payload.venue_lat ?? null;
  if ("venue_lng" in payload) update.venue_lng = payload.venue_lng ?? null;
  if ("price_general" in payload)
    update.price_general = payload.price_general ?? null;
  if ("price_student" in payload)
    update.price_student = payload.price_student ?? null;
  if ("ticket_types" in payload)
    update.ticket_types = payload.ticket_types ?? [];
  if ("tags" in payload) update.tags = normalizeTags(payload.tags) ?? [];
  if ("image_url" in payload) update.image_url = payload.image_url ?? null;
  if ("flyer_url" in payload) update.flyer_url = payload.flyer_url ?? null;
  if ("analysis_flyer_url" in payload) {
    update.analysis_flyer_url = payload.analysis_flyer_url ?? null;
  }
  if ("ticket_url" in payload) update.ticket_url = payload.ticket_url ?? null;
  if ("cast" in payload) update["cast"] = payload.cast ?? [];
  if ("ai_confidence" in payload)
    update.ai_confidence = payload.ai_confidence ?? null;
  if (supersededByUpdate !== undefined) update.superseded_by = supersededByUpdate;
  if (payload.status) update.status = payload.status;

  // 更新する項目が無い（送られたslugが現在値と同じだけ、など）ときは、空のupdateを
  // 送ると0行になり .single() がエラー（DB_ERROR 500）になるため、DB更新・転送登録・
  // 再検証を省いて現在の公演を返す（下の通常応答と同じ形・同じ列）。
  if (Object.keys(update).length === 0) {
    return NextResponse.json({
      data: {
        event: {
          id: current.id,
          category: current.category,
          slug: current.slug,
          status: current.status,
        },
      },
    });
  }

  // 保存前・保存後に、この公演が公開ページで一致する (カテゴリ, slug) の組。
  // slug は1つなので、組は「カテゴリの一覧＋slug」で表す。
  const newCategory = (update.category as string | undefined) ?? current.category;
  const newSlug = (update.slug as string | undefined) ?? current.slug;
  const newCategories = "categories" in update ? update.categories : current.categories;
  const categoriesBefore = toCategorySet(current.category, current.categories);
  const categoriesAfter = toCategorySet(newCategory, newCategories);
  const slugChanged = newSlug !== current.slug;
  const primaryPairChanged = slugChanged || newCategory !== current.category;
  // 保存前は公開ページに出ていなかった公演が、この保存で出る状態（published かつ公開日が空か過去）に
  // なるか（下書きの公開など）。status・publish_at を送らなければ保存前のまま。
  const newStatus = (update.status as string | undefined) ?? current.status;
  const newPublishAt =
    "publish_at" in update ? (update.publish_at as string | null) : current.publish_at;
  const becomesVisible =
    !isPubliclyVisible(current) &&
    isPubliclyVisible({ status: newStatus, publish_at: newPublishAt });

  // 保存後に新しく一致するようになる組が、ほかの公演の以前のURL（event_redirects）として
  // 使われていたら断る（POST と同じ理由）。
  // - 保存前から一致していた組は確かめない（URLを変えない編集を、前からある組のせいで止めないため）
  // - ただし保存後の主カテゴリの組が保存前と違うときは、その組を必ず確かめる。公開ページは
  //   主カテゴリの一致を categories の一致より先に選ぶので、categories から主カテゴリへの
  //   昇格でも、そのURLでの優先度が上がるため
  // - 公開ページに出ていなかった公演がこの保存で出るようになるとき（URLを変えずに下書きを公開する、
  //   など）は、保存後の組（主カテゴリ＋categories）をすべて確かめる。出ていなかった間は、
  //   その組を公開ページで使っていなかったため
  const addedCategories =
    slugChanged || becomesVisible
      ? [...categoriesAfter]
      : categoriesAfter.filter((item) => !categoriesBefore.includes(item));
  if (primaryPairChanged && !addedCategories.includes(newCategory)) {
    addedCategories.push(newCategory);
  }
  if (addedCategories.length > 0) {
    const reservation = await findReservedRedirect(
      service,
      newSlug,
      addedCategories,
      current.id
    );
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
  }

  // 保存後の主カテゴリの組 (category, slug) を、別の公演がすでに使っていないか（events の一意制約は
  // (category, slug) だけ）。使っていれば下の更新は一意制約で 409 になるので、旧URLを登録する前に
  // 同じ形の 409 を返して何も書かない（登録した行だけが残らないようにするため）。
  // ここで確かめてから更新するまでの間に別の公演が同じ組を取ると、今までどおり更新が 409 になる。
  if (primaryPairChanged) {
    // (category, slug) は一意なので、引けるのは多くても1件
    const { data: occupants, error: occupantError } = await service
      .from("events")
      .select("id")
      .eq("category", newCategory)
      .eq("slug", newSlug);
    if (occupantError) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: occupantError.message } },
        { status: 500 }
      );
    }
    if (Array.isArray(occupants) && occupants.some((row) => row.id !== current.id)) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: EVENT_URL_TAKEN_MESSAGE } },
        { status: 409 }
      );
    }
  }

  // 保存後に一致しなくなる組を、この公演の旧URLとして event_redirects に登録する。
  // - 対象: 保存前に一致していた組（主カテゴリ＋categories）のうち保存後に一致しなくなる組と、
  //   保存前の主カテゴリの組（保存後も categories で一致していても、主カテゴリの一致が無くなると
  //   別の公演がその組を主カテゴリで取れて、優先して表示されてしまうため）
  // - 保存前のこの公演のURLが一般に見られる状態だったときだけ（下書き・非公開・公開日前の公演は
  //   旧URLが外に出ていないので、空いているURLを取り置かせない）
  // - categories で一致していただけの組（主カテゴリではない組）が、別の公演の今の主カテゴリの組
  //   （その公演自身のURL）なら登録しない。登録しても公開ページは主カテゴリが一致するその公演を
  //   先に表示するので転送は使われず、その公演があとでURLを変えたときに、自分の旧URLとして
  //   登録できなくなる（ほかの公演への行は上書きしないため）
  // - events を更新する前に登録する。更新してから登録するまでの間に、ほかの保存がこの旧URLを
  //   空きとして取れないようにするため（完全な直列化ではない）。登録が DB エラーなら 500 にして、
  //   events は更新しない。登録のあとで更新が失敗しても、残るのは今のこの公演自身への転送行で、
  //   主カテゴリの組はこの公演がそのまま表示され、categories の組はこの公演の正式URLへの転送に
  //   なる（categories で一致したときと同じ）ため、表示は変わらない
  const lostCategories = slugChanged
    ? [...categoriesBefore]
    : categoriesBefore.filter((item) => !categoriesAfter.includes(item));
  if (primaryPairChanged && !lostCategories.includes(current.category)) {
    lostCategories.push(current.category);
  }
  if (
    lostCategories.length > 0 &&
    isPubliclyVisible(current) &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    for (const fromCategory of lostCategories) {
      if (fromCategory !== current.category) {
        const { data: holders, error: holderError } = await service
          .from("events")
          .select("id")
          .eq("category", fromCategory)
          .eq("slug", current.slug);
        if (holderError) {
          return NextResponse.json(
            { error: { code: "DB_ERROR", message: holderError.message } },
            { status: 500 }
          );
        }
        if (Array.isArray(holders) && holders.some((row) => row.id !== current.id)) continue;
      }
      const registered = await registerOldUrlRedirect(
        service,
        fromCategory,
        current.slug,
        current.id
      );
      if (registered.error) {
        return NextResponse.json(
          { error: { code: "DB_ERROR", message: registered.error.message } },
          { status: 500 }
        );
      }
    }
  }

  let { data: updated, error: updateError } = await service
    .from("events")
    .update(update)
    .eq("id", id)
    .eq("theater_id", resolved.activeTheaterId)
    .select("id, category, slug, status")
    .single();

  const missingColumns =
    !!updateError &&
    (updateError.message.includes("column") ||
      updateError.message.includes("does not exist"));
  if (missingColumns) {
    const retryUpdate: Record<string, unknown> = { ...update };
    let retries = 0;
    let retryError = updateError;
    let retryData = updated;

    while (retryError && retries < 12) {
      const missingColumn = parseMissingColumn(retryError.message);
      if (!missingColumn || !(missingColumn in retryUpdate)) break;
      delete retryUpdate[missingColumn];

      if (Object.keys(retryUpdate).length === 0) {
        retryError = null;
        break;
      }

      const retry = await service
        .from("events")
        .update(retryUpdate)
        .eq("id", id)
        .eq("theater_id", resolved.activeTheaterId)
        .select("id, category, slug, status")
        .single();
      retryData = retry.data;
      retryError = retry.error;
      retries += 1;
    }

    if (!retryError && !retryData) {
      updated = {
        id: current.id,
        category: current.category,
        slug: current.slug,
        status: current.status,
      };
      updateError = null;
    } else {
      updated = retryData;
      updateError = retryError;
    }
  }

  if (updateError || !updated) {
    const status = updateError?.code === "23505" ? 409 : 500;
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: updateError?.message } },
      { status }
    );
  }

  // 第2引数はNext.js 16で必須化されたcacheLifeプロファイル。
  // { expire: 0 } で無条件・即時のフル再検証にする（保存→即反映を維持するため）。
  revalidateTag("events", { expire: 0 });
  revalidateTag(`event:${id}`, { expire: 0 });

  return NextResponse.json({ data: { event: updated } });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const resolved = await resolveActiveTheater(user.id);
  if (!resolved.activeTheaterId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Theater not onboarded" } },
      { status: 403 }
    );
  }

  const { error } = await service
    .from("events")
    .delete()
    .eq("id", id)
    .eq("theater_id", resolved.activeTheaterId);

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 }
    );
  }

  revalidateTag("events", { expire: 0 });
  revalidateTag(`event:${id}`, { expire: 0 });

  return NextResponse.json({ data: { ok: true } });
}
