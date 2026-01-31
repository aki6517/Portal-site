import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type ViewPayload = {
  category?: string;
  slug?: string;
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
