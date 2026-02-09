import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type SiteTagsPayload = {
  head_tag?: string | null;
  body_start_tag?: string | null;
  body_end_tag?: string | null;
};

const normalizeSnippet = (value?: string | null) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const emptyData = {
  id: 1,
  head_tag: null as string | null,
  body_start_tag: null as string | null,
  body_end_tag: null as string | null,
  updated_at: null as string | null,
};

const ensureAdmin = async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false as const, status: 401 };
  }

  const { data: admin } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!admin) {
    return { ok: false as const, status: 403 };
  }

  return { ok: true as const };
};

export async function GET() {
  const auth = await ensureAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "管理者権限がありません。" } },
      { status: auth.status }
    );
  }

  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("site_settings")
      .select("id, head_tag, body_start_tag, body_end_tag, updated_at")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: error.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: data ?? emptyData });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message:
            error instanceof Error ? error.message : "設定の取得に失敗しました。",
        },
      },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const auth = await ensureAdmin();
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "管理者権限がありません。" } },
      { status: auth.status }
    );
  }

  let payload: SiteTagsPayload;
  try {
    payload = (await req.json()) as SiteTagsPayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("site_settings")
      .upsert(
        {
          id: 1,
          head_tag: normalizeSnippet(payload.head_tag),
          body_start_tag: normalizeSnippet(payload.body_start_tag),
          body_end_tag: normalizeSnippet(payload.body_end_tag),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )
      .select("id, head_tag, body_start_tag, body_end_tag, updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: error?.message ?? "設定の更新に失敗しました。",
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message:
            error instanceof Error ? error.message : "設定の更新に失敗しました。",
        },
      },
      { status: 500 }
    );
  }
}
