import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveActiveTheater, setActiveTheaterForUser } from "@/lib/theater/activeTheater";

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
  return NextResponse.json({
    data: {
      active_theater_id: resolved.activeTheaterId,
      theaters: resolved.theaters,
    },
  });
}

export async function PATCH(req: Request) {
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

  let payload: { theater_id?: string };
  try {
    payload = (await req.json()) as { theater_id?: string };
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  const theaterId = payload.theater_id?.trim();
  if (!theaterId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "theater_id is required" } },
      { status: 400 }
    );
  }

  const result = await setActiveTheaterForUser(user.id, theaterId);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Not a theater member" } },
      { status: 403 }
    );
  }

  return NextResponse.json({ data: { active_theater_id: theaterId } });
}
