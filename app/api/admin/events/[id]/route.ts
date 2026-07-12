import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// draftレビュー画面（app/admin/events/page.tsx）専用のstatus変更API。
// 許可される遷移は published / archived のみ（draft自体への差し戻しはこのAPIでは扱わない）。
const ALLOWED_STATUS = new Set(["published", "archived"]);

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
          message: "status must be published/archived",
        },
      },
      { status: 400 }
    );
  }

  const { data: existing, error: fetchError } = await supabase
    .from("events")
    .select("id, status, title, start_date, company")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: fetchError.message } },
      { status: 500 }
    );
  }

  if (!existing) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Event not found" } },
      { status: 404 }
    );
  }

  if (status === "published") {
    if (existing.status !== "draft") {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Only draft events can be published from this screen",
          },
        },
        { status: 400 }
      );
    }
    if (
      !existing.title?.trim() ||
      !existing.start_date ||
      !existing.company?.trim()
    ) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "title, start_date, company are required before publishing",
          },
        },
        { status: 400 }
      );
    }
  }

  const { data, error } = await supabase
    .from("events")
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

  // 第2引数はNext.js 16で必須化されたcacheLifeプロファイル。{ expire: 0 } で
  // 無条件・即時のフル再検証（lib/data/events.tsのタグ設計に合わせる）。
  // published/archived どちらの遷移も公開一覧・詳細のキャッシュに影響し得るため
  // （archivedは「公開済みだった公演を取り下げる」ケースも通る)、両方で revalidate する。
  revalidateTag("events", { expire: 0 });
  revalidateTag(`event:${id}`, { expire: 0 });

  return NextResponse.json({ data });
}
