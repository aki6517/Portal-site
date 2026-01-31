import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
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

const fetchImageBase64 = async (imageUrl: string) => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error("IMAGE_FETCH_FAILED");
  }
  const contentType =
    response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { base64: buffer.toString("base64"), mimeType: contentType };
};

const callGemini = async ({
  model,
  prompt,
  imageUrl,
}: {
  model: string;
  prompt: string;
  imageUrl: string;
}) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("MISSING_GEMINI_API_KEY");
  }
  const { base64, mimeType } = await fetchImageBase64(imageUrl);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
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

const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTags = (value: unknown) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeCast = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return { name: entry, role: "", image_url: "" };
      }
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        return {
          name: String(record.name ?? ""),
          role: String(record.role ?? ""),
          image_url: String(record.image_url ?? ""),
        };
      }
      return null;
    })
    .filter(Boolean);
};

const normalizeResult = (raw: Record<string, unknown>) => {
  const aiConfidenceRaw = Number(raw.ai_confidence);
  const aiConfidence = Number.isFinite(aiConfidenceRaw)
    ? Math.min(Math.max(aiConfidenceRaw, 0), 1)
    : null;

  return {
    title: typeof raw.title === "string" ? raw.title : null,
    description: typeof raw.description === "string" ? raw.description : null,
    start_date: typeof raw.start_date === "string" ? raw.start_date : null,
    end_date: typeof raw.end_date === "string" ? raw.end_date : null,
    venue: typeof raw.venue === "string" ? raw.venue : null,
    venue_address:
      typeof raw.venue_address === "string" ? raw.venue_address : null,
    price_general: normalizeNumber(raw.price_general),
    price_student: normalizeNumber(raw.price_student),
    category: typeof raw.category === "string" ? raw.category : "other",
    tags: normalizeTags(raw.tags),
    cast: normalizeCast(raw.cast),
    ai_confidence: aiConfidence,
  };
};

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

  let payload: { flyer_url?: string };
  try {
    payload = (await req.json()) as { flyer_url?: string };
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  const flyerUrl = payload.flyer_url?.trim();
  if (!flyerUrl) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "flyer_url is required" } },
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

  const prompt = `
このチラシ画像から公演情報を抽出し、JSONのみで返してください。
説明文は不要、JSONのみを出力してください。

出力JSONスキーマ:
{
  "title": string | null,
  "description": string | null,
  "start_date": "YYYY-MM-DDTHH:mm:ss+09:00" | null,
  "end_date": "YYYY-MM-DDTHH:mm:ss+09:00" | null,
  "venue": string | null,
  "venue_address": string | null,
  "price_general": number | null,
  "price_student": number | null,
  "category": "comedy" | "conversation" | "musical" | "classic" | "dance" | "student" | "conte" | "experimental" | "other",
  "tags": string[],
  "cast": [{ "name": string, "role": string, "image_url": string }],
  "ai_confidence": number
}

ルール:
- 日付が日付のみの場合、時刻は 00:00:00 +09:00 とする
- 複数日程がある場合は開始日=最も早い日、終了日=最も遅い日
- 料金が不明な場合は null
- カテゴリが不明な場合は "other"
- ai_confidence は 0-1 の範囲
`;

  try {
    const firstResult = (await callGemini({
      model: "gemini-2.5-flash",
      prompt,
      imageUrl: flyerUrl,
    })) as Record<string, unknown>;

    let normalized = normalizeResult(firstResult);

    if (
      normalized.ai_confidence === null ||
      normalized.ai_confidence < 0.8
    ) {
      const fallbackResult = (await callGemini({
        model: "gemini-2.5-pro",
        prompt,
        imageUrl: flyerUrl,
      })) as Record<string, unknown>;
      normalized = normalizeResult(fallbackResult);
    }

    return NextResponse.json({ data: { result: normalized } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI_ANALYSIS_FAILED";
    return NextResponse.json(
      { error: { code: "AI_ERROR", message } },
      { status: 500 }
    );
  }
}
