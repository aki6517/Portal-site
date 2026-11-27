import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 劇団向けの画面は応答の error.message をそのまま表示するので、message は劇団の人が読んで次に何をすれば
// いいか分かる日本語にする（error.code と HTTP ステータスは機械が読む値なので変えない）。
// DB などのエラー文は応答に出さず、サーバーのログ（console.error）に code・message を残す。
const LOGIN_REQUIRED_MESSAGE =
  "ログインが必要です。ログインし直してから、もう一度お試しください。";
const INVALID_BODY_MESSAGE =
  "送られた内容を読み取れませんでした。画面を読み込み直してから、もう一度お試しください。";
const RATE_LIMITED_MESSAGE =
  "短い時間に何度も送られました。1分ほど待ってから、もう一度お試しください。";
const SAVE_FAILED_MESSAGE =
  "保存に失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const PROMOTION_INPUT_REQUIRED_MESSAGE =
  "宣伝文を作る公演と、投稿先（SNS）を選んでください。";
const PROMOTION_EVENT_NOT_FOUND_MESSAGE =
  "公演が見つかりませんでした。画面を読み込み直してから、もう一度お試しください。";
const MEMBERSHIP_CHECK_FAILED_MESSAGE =
  "所属の確認に失敗しました。時間をおいてもう一度お試しください。";
const PROMOTION_FAILED_MESSAGE =
  "宣伝文を作れませんでした。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";

const logError = (context: string, error: { code?: string; message?: string } | null | undefined) => {
  console.error(`[api/ai/generate-promotion] ${context}`, { code: error?.code, message: error?.message });
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const getClientKey = (req: Request, userId: string) => {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip =
    forwarded.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return `${userId}:${ip}`;
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

// AI の応答の文から JSON を取り出す。JSON.parse の SyntaxError の文には応答の断片が入るので、
// 固定の識別子（GEMINI_INVALID_JSON）と HTTP ステータスだけの例外にする（ログ・例外に応答の中身を残さない）。
const extractJson = (text: string, status: number) => {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("JSON_NOT_FOUND");
  }
  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error(`GEMINI_INVALID_JSON:${status}`);
  }
};

// Gemini の失敗の応答から、ログに残してよいもの（HTTP ステータスと、上流の決まった識別子
// error.status・error.code）だけを取り出す。応答の本文そのもの（上流のエラーの文。URL に鍵が入る
// 上流エラーなら鍵も入りうる）は、例外の文にもログにも入れない。
const summarizeGeminiError = async (response: Response) => {
  let id = "";
  try {
    const body = (await response.json()) as { error?: { status?: unknown; code?: unknown } };
    const status = body?.error?.status;
    const code = body?.error?.code;
    id = [
      typeof status === "string" && /^[A-Z_]{1,64}$/.test(status) ? status : "",
      typeof code === "number" && Number.isInteger(code) ? String(code) : "",
    ]
      .filter(Boolean)
      .join("/");
  } catch {
    // 本文が JSON でないときは識別子なし
  }
  return `GEMINI_ERROR:${response.status}${id ? `:${id}` : ""}`;
};

const callGemini = async ({
  model,
  prompt,
}: {
  model: string;
  prompt: string;
}) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("MISSING_GEMINI_API_KEY");
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.6,
          response_mime_type: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await summarizeGeminiError(response));
  }

  // 応答の本文が JSON でないとき（SyntaxError の文に本文の断片が入る）も、固定の識別子にする
  let data: {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new Error(`GEMINI_INVALID_JSON:${response.status}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("GEMINI_EMPTY_RESPONSE");
  }
  return extractJson(text, response.status);
};

// 本文が普通のオブジェクト（JSON の null・配列・文字列などではない）か。違うと payload.xxx で例外（500）になる
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
// 無い（undefined・null）か文字列か。数値などだと trim() で例外（500）になる
const isOptionalString = (value: unknown) =>
  value === undefined || value === null || typeof value === "string";

const allowedPlatforms = new Set(["twitter", "instagram", "facebook"]);

type Promotion = {
  platform: string;
  text: string;
  hashtags: string[];
};

export async function POST(req: Request) {
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

  let payload: { event_id?: string; platforms?: string[] };
  try {
    payload = (await req.json()) as { event_id?: string; platforms?: string[] };
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
  if (!isOptionalString(payload.event_id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: PROMOTION_INPUT_REQUIRED_MESSAGE } },
      { status: 400 }
    );
  }

  // platforms は文字列の配列（要素が文字列でないものを黙って捨てずに、絞り込む前に 400 にする）
  if (
    !(
      payload.platforms === undefined ||
      payload.platforms === null ||
      (Array.isArray(payload.platforms) &&
        payload.platforms.every((platform) => typeof platform === "string"))
    )
  ) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: PROMOTION_INPUT_REQUIRED_MESSAGE } },
      { status: 400 }
    );
  }

  const eventId = payload.event_id?.trim();
  const platforms = Array.isArray(payload.platforms)
    ? payload.platforms.filter((platform) => allowedPlatforms.has(platform))
    : [];

  if (!eventId || platforms.length === 0) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: PROMOTION_INPUT_REQUIRED_MESSAGE,
        },
      },
      { status: 400 }
    );
  }

  const rateKey = getClientKey(req, user.id);
  const limit = checkRateLimit(rateKey);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: RATE_LIMITED_MESSAGE,
        },
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select(
      "id, theater_id, title, slug, category, description, company, start_date, end_date, venue, price_general, price_student"
    )
    .eq("id", eventId)
    .single();

  if (eventError || !event) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: PROMOTION_EVENT_NOT_FOUND_MESSAGE } },
      { status: 404 }
    );
  }

  // 公開公演は RLS で誰でも読めるため、取得できただけでは自劇団の公演とは限らない。
  // 外部 AI を呼ぶ前・promotions に書く前に、公演の劇団（アクティブかどうかは問わない）の所属メンバーかを確かめる。
  // resolveActiveTheater は user_settings に書き込むことがあり、取得エラーも空扱いになるため使わず、直接引く。
  let service: ReturnType<typeof createSupabaseServiceClient>;
  let isEventTheaterMember = false;
  try {
    service = createSupabaseServiceClient();
    const { data: membership, error: membershipError } = await service
      .from("theater_members")
      .select("theater_id")
      .eq("user_id", user.id)
      .eq("theater_id", event.theater_id)
      .maybeSingle();

    if (membershipError) {
      logError("theater_members の読み込みに失敗", membershipError);
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: MEMBERSHIP_CHECK_FAILED_MESSAGE } },
        { status: 500 }
      );
    }
    isEventTheaterMember = Boolean(membership);
  } catch {
    // 鍵の未設定などでクライアントの生成が例外を投げたとき。例外の文言は返さない（設定値などを応答に混ぜない）
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: MEMBERSHIP_CHECK_FAILED_MESSAGE,
        },
      },
      { status: 500 }
    );
  }

  if (!isEventTheaterMember) {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "この公演の宣伝文は、公演の劇団のメンバーだけが作成できます。",
        },
      },
      { status: 403 }
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://fukuoka-stage.com";
  const eventUrl = `${baseUrl}/events/${event.category}/${event.slug}`;

  const prompt = `
以下の公演情報を元に、指定されたSNS向けの宣伝文を作成してください。
JSONのみを出力し、説明文は不要です。

公演情報:
- タイトル: ${event.title}
- 劇団: ${event.company}
- 開催日: ${event.start_date} 〜 ${event.end_date ?? ""}
- 会場: ${event.venue ?? ""}
- 料金: 一般 ${event.price_general ?? ""}円 / 学生 ${event.price_student ?? ""}円
- カテゴリー: ${event.category}
- あらすじ: ${event.description ?? ""}
- URL: ${eventUrl}

対象プラットフォーム: ${platforms.join(", ")}

出力JSONスキーマ:
{
  "promotions": [
    { "platform": "twitter", "text": string, "hashtags": string[] },
    { "platform": "instagram", "text": string, "hashtags": string[] },
    { "platform": "facebook", "text": string, "hashtags": string[] }
  ]
}

要件:
- twitter: 140文字以内、絵文字OK、ハッシュタグ5つ
- instagram: 2200文字以内、改行・絵文字で読みやすく、ハッシュタグ10個
- facebook: 300文字程度、フォーマル、URL強調
- 指定されたプラットフォームのみ含める
`;

  try {
    const result = (await callGemini({
      model: "gemini-3.0-flash",
      prompt,
    })) as { promotions?: unknown };

    const promotionsRaw = Array.isArray(result.promotions)
      ? result.promotions
      : [];

    const promotions = promotionsRaw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const platform = String(record.platform ?? "");
        if (!allowedPlatforms.has(platform) || !platforms.includes(platform)) {
          return null;
        }
        const hashtags = Array.isArray(record.hashtags)
          ? record.hashtags.map(String).filter(Boolean)
          : [];
        return {
          platform,
          text: String(record.text ?? "").trim(),
          hashtags,
        };
      })
      .filter((entry): entry is Promotion => Boolean(entry && entry.text));

    if (promotions.length === 0) {
      return NextResponse.json(
        { error: { code: "AI_ERROR", message: PROMOTION_FAILED_MESSAGE } },
        { status: 500 }
      );
    }

    const { error: insertError } = await service.from("promotions").insert(
      promotions.map((promotion) => ({
        event_id: event.id,
        platform: promotion.platform,
        text: promotion.text,
        hashtags: promotion.hashtags,
      }))
    );

    if (insertError) {
      logError("promotions の保存に失敗", insertError);
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: SAVE_FAILED_MESSAGE } },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: { promotions } });
  } catch (error) {
    // AI の応答の文（英語のことがある）は応答に出さず、ログに残す
    logError("宣伝文の生成に失敗", {
      message: error instanceof Error ? error.message : "AI_GENERATION_FAILED",
    });
    return NextResponse.json(
      { error: { code: "AI_ERROR", message: PROMOTION_FAILED_MESSAGE } },
      { status: 500 }
    );
  }
}
