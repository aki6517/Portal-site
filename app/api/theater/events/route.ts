import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type EventPayload = {
  category?: string;
  slug?: string;
  title?: string;
  description?: string | null;
  start_date?: string;
  end_date?: string | null;
  venue_id?: string | null;
  venue?: string | null;
  venue_address?: string | null;
  venue_lat?: number | null;
  venue_lng?: number | null;
  price_general?: number | null;
  price_student?: number | null;
  tags?: string[] | string | null;
  image_url?: string | null;
  flyer_url?: string | null;
  ticket_url?: string | null;
  cast?: unknown[] | null;
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

export async function GET() {
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

  const { data: member, error: memberError } = await supabase
    .from("theater_members")
    .select("theater_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: memberError.message } },
      { status: 500 }
    );
  }

  if (!member) {
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
    .eq("theater_id", member.theater_id)
    .order("updated_at", { ascending: false });

  if (eventsError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: eventsError.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { events } });
}

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

  let payload: EventPayload;
  try {
    payload = (await req.json()) as EventPayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  const category = payload.category?.trim();
  const slug = payload.slug?.trim();
  const title = payload.title?.trim();
  const startDate = payload.start_date;

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

  const { data: member, error: memberError } = await supabase
    .from("theater_members")
    .select("theater_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: memberError.message } },
      { status: 500 }
    );
  }

  if (!member) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Theater not onboarded" } },
      { status: 403 }
    );
  }

  const { data: theater, error: theaterError } = await supabase
    .from("theaters")
    .select("id, name, status")
    .eq("id", member.theater_id)
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

  if (payload.status === "published" && theater.status !== "approved") {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Theater is not approved",
        },
      },
      { status: 403 }
    );
  }

  const { data: event, error: insertError } = await supabase
    .from("events")
    .insert({
      theater_id: theater.id,
      category,
      slug,
      title,
      company: theater.name,
      description: payload.description ?? null,
      start_date: startDate,
      end_date: payload.end_date ?? null,
      venue_id: payload.venue_id ?? null,
      venue: payload.venue ?? null,
      venue_address: payload.venue_address ?? null,
      venue_lat: payload.venue_lat ?? null,
      venue_lng: payload.venue_lng ?? null,
      price_general: payload.price_general ?? null,
      price_student: payload.price_student ?? null,
      tags: normalizeTags(payload.tags),
      image_url: payload.image_url ?? null,
      flyer_url: payload.flyer_url ?? null,
      ticket_url: payload.ticket_url ?? null,
      "cast": payload.cast ?? [],
      status: payload.status ?? "draft",
    })
    .select("id, category, slug, status")
    .single();

  if (insertError) {
    const status = insertError.code === "23505" ? 409 : 500;
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: insertError.message,
        },
      },
      { status }
    );
  }

  return NextResponse.json({ data: { event } }, { status: 201 });
}
