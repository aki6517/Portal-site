import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type EventUpdatePayload = {
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
  if (!tags) return undefined;
  if (Array.isArray(tags)) return tags.filter(Boolean);
  return tags
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
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

  const { data: member } = await supabase
    .from("theater_members")
    .select("theater_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Theater not onboarded" } },
      { status: 403 }
    );
  }

  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .eq("theater_id", member.theater_id)
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

  const { data: member } = await supabase
    .from("theater_members")
    .select("theater_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Theater not onboarded" } },
      { status: 403 }
    );
  }

  const { data: theater } = await supabase
    .from("theaters")
    .select("id, status")
    .eq("id", member.theater_id)
    .single();

  if (!theater) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: "Theater not found" } },
      { status: 500 }
    );
  }

  if (payload.status === "published" && theater.status !== "approved") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Theater is not approved" } },
      { status: 403 }
    );
  }

  const { data: current, error: currentError } = await supabase
    .from("events")
    .select("id, category, slug")
    .eq("id", id)
    .eq("theater_id", member.theater_id)
    .single();

  if (currentError || !current) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Event not found" } },
      { status: 404 }
    );
  }

  const update: Record<string, unknown> = {};
  if (payload.category) update.category = payload.category.trim();
  if (payload.slug) update.slug = payload.slug.trim();
  if (payload.title) update.title = payload.title.trim();
  if ("description" in payload) update.description = payload.description ?? null;
  if (payload.start_date) update.start_date = payload.start_date;
  if ("end_date" in payload) update.end_date = payload.end_date ?? null;
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
  if ("tags" in payload) update.tags = normalizeTags(payload.tags) ?? [];
  if ("image_url" in payload) update.image_url = payload.image_url ?? null;
  if ("flyer_url" in payload) update.flyer_url = payload.flyer_url ?? null;
  if ("ticket_url" in payload) update.ticket_url = payload.ticket_url ?? null;
  if ("cast" in payload) update["cast"] = payload.cast ?? [];
  if (payload.status) update.status = payload.status;

  const { data: updated, error: updateError } = await supabase
    .from("events")
    .update(update)
    .eq("id", id)
    .eq("theater_id", member.theater_id)
    .select("id, category, slug, status")
    .single();

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
    const service = createSupabaseServiceClient();
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const { data: member } = await supabase
    .from("theater_members")
    .select("theater_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Theater not onboarded" } },
      { status: 403 }
    );
  }

  const { error } = await supabase
    .from("events")
    .delete()
    .eq("id", id)
    .eq("theater_id", member.theater_id);

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { ok: true } });
}
