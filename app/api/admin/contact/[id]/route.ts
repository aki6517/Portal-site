import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_STATUS = new Set(["new", "read", "archived"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

  const { data: admin } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!admin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin only" } },
      { status: 403 }
    );
  }

  let payload: { status?: string };
  try {
    payload = (await req.json()) as { status?: string };
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  const status = payload.status?.trim();
  if (!status || !ALLOWED_STATUS.has(status)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "status must be new/read/archived",
        },
      },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("contact_messages")
    .update({ status })
    .eq("id", id)
    .select("id, status")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error?.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ data });
}
