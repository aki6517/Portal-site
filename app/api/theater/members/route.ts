import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveActiveTheater } from "@/lib/theater/activeTheater";

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

  const service = createSupabaseServiceClient();
  const resolved = await resolveActiveTheater(user.id);
  const member = resolved.activeMembership;

  if (!member || member.role !== "owner") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Owner only" } },
      { status: 403 }
    );
  }

  const { data: members, error } = await service
    .from("theater_members")
    .select("user_id, role")
    .eq("theater_id", member.theater_id);

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 }
    );
  }

  const withEmail = await Promise.all(
    (members ?? []).map(async (m) => {
      const u = await service.auth.admin.getUserById(m.user_id);
      return {
        user_id: m.user_id,
        role: m.role,
        email: u.data.user?.email ?? "",
      };
    })
  );

  return NextResponse.json({ data: { members: withEmail } });
}

export async function DELETE(req: Request) {
  let body: { userId?: string };
  try {
    body = (await req.json()) as { userId?: string };
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "invalid body" } },
      { status: 400 }
    );
  }

  if (!body.userId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "userId is required" } },
      { status: 400 }
    );
  }

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

  const service = createSupabaseServiceClient();
  const resolved = await resolveActiveTheater(user.id);
  const member = resolved.activeMembership;

  if (!member || member.role !== "owner") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Owner only" } },
      { status: 403 }
    );
  }

  // オーナー自身は削除不可
  if (body.userId === user.id) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Owner cannot be removed" } },
      { status: 403 }
    );
  }

  const { error: delError } = await service
    .from("theater_members")
    .delete()
    .eq("user_id", body.userId)
    .eq("theater_id", member.theater_id);

  if (delError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: delError.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { deleted: true } });
}
