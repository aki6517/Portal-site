import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { isReleased } from "@/lib/data/events";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type ViewPayload = {
  category?: string;
  slug?: string;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// 利用者の IP。Vercel では x-real-ip に「Vercel のプロキシが計算した利用者の IP」が入る
// （@vercel/functions の ipAddress() もこのヘッダーを読む）。x-forwarded-for も Vercel が
// 上書きし、外から送られた値は通さない（https://vercel.com/docs/headers/request-headers）。
// x-real-ip が無いとき（Vercel の外で動かしたとき）だけ x-forwarded-for の先頭を使う。
const getClientIp = (req: Request) => {
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || "unknown";
};

const checkRateLimit = (key: string) => {
  const now = Date.now();
  const existing = rateLimitStore.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
    return { ok: false, retryAfter };
  }
  existing.count += 1;
  rateLimitStore.set(key, existing);
  return { ok: true, retryAfter: 0 };
};

const getJstDateString = () => {
  const date = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

// 同じ IP・同じ公演・同じ日（日本時間）で数えるのは、この回数まで（UA を変えて増やすのを抑える。
// 同じ回線の別の人も数えられるよう、閲覧者の印そのものは IP＋UA＋日付のまま）
const VIEW_IP_LIMIT_PER_DAY = 5;

// 印はサーバーだけが知る鍵の HMAC-SHA256 にして、生の IP・User-Agent は DB に残さない。
// 材料は JSON の配列にして区切りがずれないようにし、先頭の文字列で用途を分ける。
//   閲覧者の印（重複よけ）: ["event-view:v1", ip, userAgent, viewDate]
//   IP の印（上限を数える）: ["event-ip:v1", ip, viewDate]
const hmacHex = (secret: string, parts: string[]) =>
  createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex");

// application/json（; charset=... 付きも可）だけを受ける。text/plain やフォームの POST は
// ほかのサイトからでも CORS の事前確認なしに送れてしまうので、ここで断る
const isJsonContentType = (value: string | null) =>
  (value ?? "").split(";")[0].trim().toLowerCase() === "application/json";

export async function POST(req: Request) {
  if (!isJsonContentType(req.headers.get("content-type"))) {
    return NextResponse.json(
      {
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Content-Type must be application/json",
        },
      },
      { status: 415 }
    );
  }

  let payload: ViewPayload;
  try {
    payload = (await req.json()) as ViewPayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  const category = payload.category?.trim();
  const slug = payload.slug?.trim();

  if (!category || !slug) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "category and slug are required",
        },
      },
      { status: 400 }
    );
  }

  const ip = getClientIp(req);
  const rateKey = `${ip}:${category}/${slug}`;
  const limit = checkRateLimit(rateKey);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests",
        },
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json(
      {
        error: {
          code: "CONFIG_ERROR",
          message: "SUPABASE_SERVICE_ROLE_KEY is not set",
        },
      },
      { status: 500 }
    );
  }
  // 鍵は VIEW_HASH_SECRET があればそれ、無ければ service_role の鍵（値は応答・ログに出さない）
  const viewerHashSecret = process.env.VIEW_HASH_SECRET || serviceRoleKey;

  const supabase = createSupabaseServiceClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, publish_at")
    .eq("category", category)
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  // 公開日前（publish_at が未来）の公演は、公開ページと同じく「見つからない」扱いにして数えない
  if (eventError || !event || !isReleased(event.publish_at)) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Event not found",
        },
      },
      { status: 404 }
    );
  }

  const viewDate = getJstDateString();
  const userAgent = req.headers.get("user-agent") ?? "";
  const viewerHash = hmacHex(viewerHashSecret, [
    "event-view:v1",
    ip,
    userAgent,
    viewDate,
  ]);
  const ipHash = hmacHex(viewerHashSecret, ["event-ip:v1", ip, viewDate]);

  // 重複よけ・上限・加算は DB の関数の中で一度に行う（同じ閲覧者・公演・日なら、または
  // 同じ IP・公演・日で上限に達していれば、数えず false が返る）
  const { data: counted, error: recordError } = await supabase.rpc(
    "record_event_view",
    {
      p_event_id: event.id,
      p_view_date: viewDate,
      p_viewer_hash: viewerHash,
      p_ip_hash: ipHash,
      p_ip_limit: VIEW_IP_LIMIT_PER_DAY,
    }
  );

  if (recordError) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: recordError.message,
        },
      },
      { status: 500 }
    );
  }

  // 重複・上限で数えなかったときも 200（ViewCounter は res.ok で当日の cookie を付ける）
  return NextResponse.json({ data: { ok: true, counted: counted === true } });
}
