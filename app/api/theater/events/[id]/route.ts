import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveActiveTheater } from "@/lib/theater/activeTheater";

type EventUpdatePayload = {
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
  ticket_url?: string | null;
  cast?: unknown[] | null;
  ai_confidence?: number | null;
  status?: "draft" | "published" | "archived";
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

  let { data: current, error: currentError } = await service
    .from("events")
    .select("id, category, slug, status, start_date, end_date, categories")
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

  const update: Record<string, unknown> = {};
  const incomingCategory = payload.category?.trim();
  const hasCategories = "categories" in payload;
  const hasCategory = "category" in payload;
  if (hasCategories || hasCategory) {
    const primary =
      incomingCategory ??
      (Array.isArray(payload.categories) ? payload.categories[0] : undefined) ??
      current.category;
    const normalized = normalizeCategories(payload.categories ?? null, primary);
    update.category = primary;
    update.categories = normalized;
  }
  if (payload.slug) update.slug = payload.slug.trim();
  if (payload.title) update.title = payload.title.trim();
  if ("description" in payload) update.description = payload.description ?? null;
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
  if ("venue_id" in payload) update.venue_id = payload.venue_id ?? null;
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
  if ("ticket_url" in payload) update.ticket_url = payload.ticket_url ?? null;
  if ("cast" in payload) update["cast"] = payload.cast ?? [];
  if ("ai_confidence" in payload)
    update.ai_confidence = payload.ai_confidence ?? null;
  if (payload.status) update.status = payload.status;

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
    delete retryUpdate.categories;
    delete retryUpdate.schedule_times;
    delete retryUpdate.ticket_types;
    delete retryUpdate.publish_at;
    delete retryUpdate.reservation_start_at;
    delete retryUpdate.reservation_label;
    delete retryUpdate.reservation_links;

    if (Object.keys(retryUpdate).length === 0) {
      updated = {
        id: current.id,
        category: current.category,
        slug: current.slug,
        status: current.status,
      };
      updateError = null;
    } else {
      const retry = await service
        .from("events")
        .update(retryUpdate)
        .eq("id", id)
        .eq("theater_id", resolved.activeTheaterId)
        .select("id, category, slug, status")
        .single();
      updated = retry.data;
      updateError = retry.error;
    }
  }

  if (updateError || !updated) {
    const status = updateError?.code === "23505" ? 409 : 500;
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: updateError?.message } },
      { status }
    );
  }

  const newCategory = (update.category as string | undefined) ?? current.category;
  const newSlug = (update.slug as string | undefined) ?? current.slug;

  if (
    (newCategory !== current.category || newSlug !== current.slug) &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    await service.from("event_redirects").upsert(
      {
        from_category: current.category,
        from_slug: current.slug,
        to_event_id: current.id,
      },
      { onConflict: "from_category,from_slug" }
    );
  }

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

  return NextResponse.json({ data: { ok: true } });
}
