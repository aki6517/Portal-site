import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type ViewPayload = {
  category?: string;
  slug?: string;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const getClientIp = (req: Request) => {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return (
    forwarded.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
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

export async function POST(req: Request) {
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

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
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

  const supabase = createSupabaseServiceClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, views, status")
    .eq("category", category)
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (eventError || !event) {
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

  const { data: daily, error: dailyError } = await supabase
    .from("event_views_daily")
    .select("views")
    .eq("event_id", event.id)
    .eq("view_date", viewDate)
    .maybeSingle();

  if (dailyError) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: dailyError.message,
        },
      },
      { status: 500 }
    );
  }

  if (daily) {
    const { error: updateDailyError } = await supabase
      .from("event_views_daily")
      .update({ views: (daily.views ?? 0) + 1 })
      .eq("event_id", event.id)
      .eq("view_date", viewDate);

    if (updateDailyError) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: updateDailyError.message,
          },
        },
        { status: 500 }
      );
    }
  } else {
    const { error: insertDailyError } = await supabase
      .from("event_views_daily")
      .insert({ event_id: event.id, view_date: viewDate, views: 1 });

    if (insertDailyError) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: insertDailyError.message,
          },
        },
        { status: 500 }
      );
    }
  }

  const { error: updateEventError } = await supabase
    .from("events")
    .update({ views: (event.views ?? 0) + 1 })
    .eq("id", event.id);

  if (updateEventError) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: updateEventError.message,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { ok: true } });
}
