import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

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

const extractJson = (text: string) => {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenceMatch ? fenceMatch[1] : trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("JSON_NOT_FOUND");
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
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
    const text = await response.text();
    throw new Error(`GEMINI_ERROR:${response.status}:${text}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("GEMINI_EMPTY_RESPONSE");
  }
  return extractJson(text);
};

const allowedPlatforms = new Set(["twitter", "instagram", "facebook"]);

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  let payload: { event_id?: string; platforms?: string[] };
  try {
    payload = (await req.json()) as { event_id?: string; platforms?: string[] };
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
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
          message: "event_id and platforms are required",
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
          message: "Too many requests",
        },
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select(
      "id, title, slug, category, description, company, start_date, end_date, venue, price_general, price_student"
    )
    .eq("id", eventId)
    .single();

  if (eventError || !event) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Event not found" } },
      { status: 404 }
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
      .filter((entry) => entry && entry.text);

    if (promotions.length === 0) {
      return NextResponse.json(
        { error: { code: "AI_ERROR", message: "No promotions generated" } },
        { status: 500 }
      );
    }

    const service = createSupabaseServiceClient();
    const { error: insertError } = await service.from("promotions").insert(
      promotions.map((promotion) => ({
        event_id: event.id,
        platform: promotion.platform,
        text: promotion.text,
        hashtags: promotion.hashtags,
      }))
    );

    if (insertError) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: insertError.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: { promotions } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI_GENERATION_FAILED";
    return NextResponse.json(
      { error: { code: "AI_ERROR", message } },
      { status: 500 }
    );
  }
}
