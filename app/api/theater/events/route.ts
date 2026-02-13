import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveActiveTheater } from "@/lib/theater/activeTheater";

type EventPayload = {
  category?: string;
  categories?: string[];
  slug?: string;
  title?: string;
  description?: string | null;
  publish_at?: string | null;
  start_date?: string;
  end_date?: string | null;
  reservation_start_at?: string | null;
  reservation_label?: string | null;
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
  ticket_url?: string | null;
  cast?: unknown[] | null;
  ai_confidence?: number | null;
  status?: "draft" | "published" | "archived";
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

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select(
      "id, title, slug, category, status, start_date, end_date, updated_at"
    )
    .eq("theater_id", resolved.activeTheaterId)
    .order("updated_at", { ascending: false });

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

  const category = payload.category?.trim() ?? "";
  const categories = normalizeCategories(payload.categories ?? null, category);
  const slug = payload.slug?.trim();
  const title = payload.title?.trim();
  const scheduleTimes = normalizeScheduleTimes(payload.schedule_times);
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

  const { data: event, error: insertError } = await service
    .from("events")
    .insert({
      theater_id: theater.id,
      category,
      slug,
      title,
      company: theater.name,
      description: payload.description ?? null,
      publish_at: payload.publish_at ?? null,
      start_date: startDate,
      end_date: endDate ?? null,
      reservation_start_at: payload.reservation_start_at ?? null,
      reservation_label: payload.reservation_label ?? null,
      schedule_times: scheduleTimes,
      venue_id: payload.venue_id ?? null,
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
      ticket_url: payload.ticket_url ?? null,
      "cast": payload.cast ?? [],
      ai_confidence:
        payload.ai_confidence !== undefined ? payload.ai_confidence : null,
      status: payload.status ?? "draft",
      categories,
    })
    .select("id, category, slug, status")
    .single();

  let createdEvent = event;
  let createdError = insertError;
  const missingColumns =
    !!createdError &&
    (createdError.message.includes("column") ||
      createdError.message.includes("does not exist"));

  if (missingColumns) {
    const retryPayload = {
      theater_id: theater.id,
      category,
      slug,
      title,
      company: theater.name,
      description: payload.description ?? null,
      start_date: startDate,
      end_date: endDate ?? null,
      schedule_times: scheduleTimes,
      venue_id: payload.venue_id ?? null,
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
      ticket_url: payload.ticket_url ?? null,
      "cast": payload.cast ?? [],
      ai_confidence:
        payload.ai_confidence !== undefined ? payload.ai_confidence : null,
      status: payload.status ?? "draft",
      categories,
    };
    const retry = await service
      .from("events")
      .insert(retryPayload)
      .select("id, category, slug, status")
      .single();
    createdEvent = retry.data;
    createdError = retry.error;
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

  return NextResponse.json({ data: { event: createdEvent } }, { status: 201 });
}
