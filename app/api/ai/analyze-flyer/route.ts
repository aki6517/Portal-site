import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const CATEGORY_IDS = new Set([
  "comedy",
  "conversation",
  "musical",
  "classic",
  "action",
  "serious",
  "drama",
  "dance",
  "student",
  "conte",
  "experimental",
  "other",
]);

const DEFAULT_MODEL_CANDIDATES = [
  "gemini-3.0-pro",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
];

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

const normalizeUrl = (value?: string | null) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const fetchImageBase64 = async (imageUrl: string) => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`IMAGE_FETCH_FAILED:${response.status}`);
  }
  const contentType =
    response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { base64: buffer.toString("base64"), mimeType: contentType };
};

const decodeHtml = (value: string) =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const stripHtml = (html: string) =>
  decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );

type PageContext = {
  url: string;
  title: string;
  description: string;
  bodyText: string;
};

const fetchPageContext = async (pageUrl: string): Promise<PageContext> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(pageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "FukuokaActPortalAnalyzer/1.0 (+https://portal.galapagos-dynamos.com)",
      },
    });
    if (!response.ok) {
      throw new Error(`PAGE_FETCH_FAILED:${response.status}`);
    }
    const html = await response.text();
    const title = decodeHtml(
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
    ).trim();

    const description =
      decodeHtml(
        html.match(
          /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["'][^>]*>/i
        )?.[1] ?? ""
      ).trim() || "";

    const bodyText = stripHtml(html).slice(0, 12_000);

    return { url: pageUrl, title, description, bodyText };
  } finally {
    clearTimeout(timeout);
  }
};

const getModelCandidates = () => {
  const fromEnv =
    process.env.GEMINI_ANALYZE_MODELS
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? [];
  return fromEnv.length > 0 ? fromEnv : DEFAULT_MODEL_CANDIDATES;
};

const callGemini = async ({
  model,
  prompt,
  imageUrl,
  pageContextText,
}: {
  model: string;
  prompt: string;
  imageUrl?: string | null;
  pageContextText?: string | null;
}) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("MISSING_GEMINI_API_KEY");
  }

  const parts: Array<
    | { text: string }
    | { inline_data: { mime_type: string; data: string } }
  > = [{ text: prompt }];

  if (pageContextText) {
    parts.push({
      text: `公演ページ補助情報:\n${pageContextText.slice(0, 12_000)}`,
    });
  }

  if (imageUrl) {
    const { base64, mimeType } = await fetchImageBase64(imageUrl);
    parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
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
        return { name: entry.trim(), role: "", image_url: "" };
      }
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        return {
          name: String(record.name ?? "").trim(),
          role: String(record.role ?? "").trim(),
          image_url: String(record.image_url ?? "").trim(),
        };
      }
      return null;
    })
    .filter(
      (item): item is { name: string; role: string; image_url: string } => {
        if (!item) return false;
        return Boolean(item.name || item.role || item.image_url);
      }
    );
};

const normalizeScheduleTimes = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const rows = value
    .map((entry) => {
      if (typeof entry === "string") {
        const start = entry.trim();
        return start ? { start_date: start, end_date: null, label: "" } : null;
      }
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const startDate = String(record.start_date ?? "").trim();
        if (!startDate) return null;
        const endDateRaw = String(record.end_date ?? "").trim();
        return {
          start_date: startDate,
          end_date: endDateRaw || null,
          label: String(record.label ?? "").trim(),
        };
      }
      return null;
    })
    .filter(
      (item): item is { start_date: string; end_date: string | null; label: string } =>
        Boolean(item)
    );

  const unique = Array.from(
    new Map(rows.map((item) => [`${item.start_date}::${item.label}`, item])).values()
  );
  return unique.sort((a, b) => a.start_date.localeCompare(b.start_date));
};

const normalizeReservationLinks = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      return {
        label: String(record.label ?? "").trim(),
        url: String(record.url ?? "").trim(),
      };
    })
    .filter(
      (item): item is { label: string; url: string } => {
        if (!item) return false;
        return Boolean(item.label || item.url);
      }
    );
};

const normalizeTicketTypes = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      return {
        label: String(record.label ?? "").trim(),
        price: normalizeNumber(record.price),
        note: String(record.note ?? "").trim(),
      };
    })
    .filter(
      (
        item
      ): item is { label: string; price: number | null; note: string } => {
        if (!item) return false;
        return Boolean(item.label || item.price !== null || item.note);
      }
    );
};

const pickPriceByLabels = (
  tickets: { label: string; price: number | null }[],
  labels: RegExp
) => {
  const matched = tickets.find((item) => labels.test(item.label));
  return matched?.price ?? null;
};

const normalizeCategory = (value: unknown) => {
  const category = String(value ?? "other").trim().toLowerCase();
  return CATEGORY_IDS.has(category) ? category : "other";
};

const normalizeResult = (raw: Record<string, unknown>) => {
  const scheduleTimes = normalizeScheduleTimes(raw.schedule_times);
  const reservationLinks = normalizeReservationLinks(raw.reservation_links);
  const ticketTypes = normalizeTicketTypes(raw.ticket_types);
  const aiConfidenceRaw = Number(raw.ai_confidence);
  const aiConfidence = Number.isFinite(aiConfidenceRaw)
    ? Math.min(Math.max(aiConfidenceRaw, 0), 1)
    : null;

  const startDateRaw = String(raw.start_date ?? "").trim();
  const endDateRaw = String(raw.end_date ?? "").trim();
  const fallbackStart = scheduleTimes[0]?.start_date ?? null;
  const fallbackEnd = scheduleTimes[scheduleTimes.length - 1]?.end_date ?? null;

  const priceGeneral = normalizeNumber(raw.price_general);
  const priceStudent = normalizeNumber(raw.price_student);

  return {
    title: typeof raw.title === "string" ? raw.title : null,
    description: typeof raw.description === "string" ? raw.description : null,
    playwright: typeof raw.playwright === "string" ? raw.playwright : null,
    director: typeof raw.director === "string" ? raw.director : null,
    start_date: startDateRaw || fallbackStart,
    end_date: endDateRaw || fallbackEnd,
    schedule_times: scheduleTimes,
    reservation_links: reservationLinks,
    venue: typeof raw.venue === "string" ? raw.venue : null,
    venue_address:
      typeof raw.venue_address === "string" ? raw.venue_address : null,
    ticket_types: ticketTypes,
    price_general:
      priceGeneral ??
      pickPriceByLabels(ticketTypes, /一般|general/i),
    price_student:
      priceStudent ??
      pickPriceByLabels(ticketTypes, /学生|student/i),
    category: normalizeCategory(raw.category),
    tags: normalizeTags(raw.tags),
    cast: normalizeCast(raw.cast),
    ai_confidence: aiConfidence,
  };
};

const buildPrompt = (pageContext?: PageContext | null) => {
  const pageHint = pageContext
    ? `
補助情報（公演ページ）:
- URL: ${pageContext.url}
- タイトル: ${pageContext.title || "不明"}
- 説明: ${pageContext.description || "不明"}
`
    : "";

  return `
あなたは舞台公演データ抽出アシスタントです。入力（チラシ画像と公演ページ情報）から、公演情報を抽出してJSONのみで返してください。
説明文やマークダウンは不要です。必ず1つのJSONオブジェクトのみを返してください。
${pageHint}
出力JSONスキーマ:
{
  "title": string | null,
  "description": string | null,
  "playwright": string | null,
  "director": string | null,
  "start_date": "YYYY-MM-DDTHH:mm:ss+09:00" | null,
  "end_date": "YYYY-MM-DDTHH:mm:ss+09:00" | null,
  "schedule_times": [{ "start_date": "YYYY-MM-DDTHH:mm:ss+09:00", "end_date": "YYYY-MM-DDTHH:mm:ss+09:00" | null, "label": string }],
  "reservation_links": [{ "label": string, "url": string }],
  "venue": string | null,
  "venue_address": string | null,
  "ticket_types": [{ "label": string, "price": number | null, "note": string }],
  "price_general": number | null,
  "price_student": number | null,
  "category": "comedy" | "conversation" | "musical" | "classic" | "action" | "serious" | "drama" | "dance" | "student" | "conte" | "experimental" | "other",
  "tags": string[],
  "cast": [{ "name": string, "role": string, "image_url": string }],
  "ai_confidence": number
}

ルール:
- 画像と公演ページで矛盾がある場合は、より具体的かつ最新と判断できる情報を優先
- 日付が日付のみの場合、時刻は 00:00:00+09:00 を補完
- 複数日程がある場合は schedule_times に全て格納（最低でも start_date を設定）
- start_date は最も早い schedule_times.start_date、end_date は最も遅い日程の end_date（なければ null）
- 予約窓口は reservation_links に複数入れる
- 料金は ticket_types を優先し、価格不明は null
- カテゴリ不明は "other"
- ai_confidence は 0.0〜1.0
`;
};

export async function POST(req: Request) {
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

  let payload: { flyer_url?: string; page_url?: string };
  try {
    payload = (await req.json()) as { flyer_url?: string; page_url?: string };
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  const flyerUrl = normalizeUrl(payload.flyer_url);
  const pageUrl = normalizeUrl(payload.page_url);

  if (!flyerUrl && !pageUrl) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "flyer_url or page_url is required",
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

  const warnings: string[] = [];
  let pageContext: PageContext | null = null;

  if (pageUrl) {
    try {
      pageContext = await fetchPageContext(pageUrl);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "PAGE_CONTEXT_FAILED";
      if (!flyerUrl) {
        return NextResponse.json(
          { error: { code: "PAGE_FETCH_ERROR", message } },
          { status: 400 }
        );
      }
      warnings.push(`page_url解析失敗: ${message}`);
    }
  }

  const prompt = buildPrompt(pageContext);
  const models = getModelCandidates();
  const modelErrors: string[] = [];

  try {
    for (const model of models) {
      try {
        const raw = (await callGemini({
          model,
          prompt,
          imageUrl: flyerUrl,
          pageContextText: pageContext
            ? `URL: ${pageContext.url}\nTitle: ${pageContext.title}\nDescription: ${pageContext.description}\nBody: ${pageContext.bodyText}`
            : null,
        })) as Record<string, unknown>;

        const normalized = normalizeResult(raw);
        return NextResponse.json({
          data: {
            result: normalized,
            model,
            warnings,
          },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "GEMINI_CALL_FAILED";
        modelErrors.push(`${model}:${message}`);
      }
    }

    throw new Error(modelErrors.join(" | "));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI_ANALYSIS_FAILED";
    return NextResponse.json(
      { error: { code: "AI_ERROR", message } },
      { status: 500 }
    );
  }
}
