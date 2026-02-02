import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type OnboardPayload = {
  name?: string;
  contact_email?: string;
  website_url?: string | null;
  sns_x_url?: string | null;
  sns_instagram_url?: string | null;
  sns_facebook_url?: string | null;
  description?: string | null;
  logo_url?: string | null;
};

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function POST(req: Request) {
  let payload: OnboardPayload;
  try {
    payload = (await req.json()) as OnboardPayload;
  } catch {
    return NextResponse.json(
      {
        error: { code: "INVALID_JSON", message: "Request body is invalid" },
      },
      { status: 400 }
    );
  }

  const name = payload.name?.trim();
  const contactEmail = payload.contact_email?.trim();

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

  const service = createSupabaseServiceClient();

  const { data: existingTheater, error: theaterCheckError } = await service
    .from("theaters")
    .select("id")
    .ilike("name", name)
    .maybeSingle();

  if (theaterCheckError) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: theaterCheckError.message,
        },
      },
      { status: 500 }
    );
  }

  if (existingTheater) {
    return NextResponse.json(
      {
        error: {
          code: "THEATER_NAME_EXISTS",
          message: "同じ名前の劇団が既に登録されています",
        },
      },
      { status: 409 }
    );
  }

  const { data: existingMember, error: memberError } = await service
    .from("theater_members")
    .select("theater_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (memberError) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: memberError.message,
        },
      },
      { status: 500 }
    );
  }

  if (existingMember) {
    return NextResponse.json(
      {
        error: {
          code: "ALREADY_ONBOARDED",
          message: "User already belongs to a theater",
        },
      },
      { status: 409 }
    );
  }

  const { data: theater, error: theaterError } = await service
    .from("theaters")
    .insert({
      name,
      contact_email: contactEmail,
      website_url: payload.website_url ?? null,
      sns_x_url: payload.sns_x_url ?? null,
      sns_instagram_url: payload.sns_instagram_url ?? null,
      sns_facebook_url: payload.sns_facebook_url ?? null,
      description: payload.description ?? null,
      logo_url: payload.logo_url ?? null,
      status: "approved",
    })
    .select("id, status")
    .single();

  if (theaterError || !theater) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: theaterError?.message ?? "Failed to create theater",
        },
      },
      { status: 500 }
    );
  }

  const { error: linkError } = await service.from("theater_members").insert({
    theater_id: theater.id,
    user_id: user.id,
    role: "owner",
  });

  if (linkError) {
    await service.from("theaters").delete().eq("id", theater.id);
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: linkError.message,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { theater } }, { status: 201 });
}
