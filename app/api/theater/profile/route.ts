import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveActiveTheater } from "@/lib/theater/activeTheater";

type TheaterProfilePayload = {
  name?: string;
  description?: string | null;
  contact_email?: string;
  website_url?: string | null;
};

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const normalizeUrl = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
};

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
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

  const service = createSupabaseServiceClient();
  const { data: theater, error } = await service
    .from("theaters")
    .select("id, name, description, contact_email, website_url, status")
    .eq("id", resolved.activeTheaterId)
    .single();

  if (error || !theater) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: error?.message ?? "Theater not found",
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data: {
      theater,
      member: resolved.activeMembership
        ? { role: resolved.activeMembership.role }
        : null,
    },
  });
}

export async function PATCH(req: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const resolved = await resolveActiveTheater(user.id);
  if (!resolved.activeTheaterId || !resolved.activeMembership) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Theater not onboarded" } },
      { status: 403 }
    );
  }

  let payload: TheaterProfilePayload;
  try {
    payload = (await req.json()) as TheaterProfilePayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  const name = payload.name?.trim() ?? "";
  const contactEmail = payload.contact_email?.trim() ?? "";
  const description = payload.description?.trim() || null;
  const websiteUrl = normalizeUrl(payload.website_url);

  if (!name || !contactEmail || !isValidEmail(contactEmail)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "name and contact_email are required",
        },
      },
      { status: 400 }
    );
  }

  const service = createSupabaseServiceClient();
  const { data: current, error: currentError } = await service
    .from("theaters")
    .select("id, name")
    .eq("id", resolved.activeTheaterId)
    .single();

  if (currentError || !current) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: currentError?.message ?? "Theater not found",
        },
      },
      { status: 500 }
    );
  }

  const { data: updated, error: updateError } = await service
    .from("theaters")
    .update({
      name,
      description,
      contact_email: contactEmail,
      website_url: websiteUrl,
    })
    .eq("id", current.id)
    .select("id, name, description, contact_email, website_url, status")
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: updateError?.message ?? "Failed to update theater",
        },
      },
      { status: 500 }
    );
  }

  if (current.name !== updated.name) {
    await service
      .from("events")
      .update({ company: updated.name })
      .eq("theater_id", current.id);
  }

  return NextResponse.json({ data: { theater: updated } });
}
