import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveActiveTheater } from "@/lib/theater/activeTheater";

// 劇団向けの画面は応答の error.message をそのまま表示するので、message は劇団の人が読んで次に何をすれば
// いいか分かる日本語にする（error.code と HTTP ステータスは機械が読む値なので変えない）。
// DB などのエラー文は応答に出さず、サーバーのログ（console.error）に code・message を残す。
const LOGIN_REQUIRED_MESSAGE =
  "ログインが必要です。ログインし直してから、もう一度お試しください。";
const INVALID_BODY_MESSAGE =
  "送られた内容を読み取れませんでした。画面を読み込み直してから、もう一度お試しください。";
const OWNER_ONLY_MESSAGE =
  "この操作は、劇団の代表（オーナー）だけができます。";
const LOAD_FAILED_MESSAGE =
  "読み込みに失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const DELETE_FAILED_MESSAGE =
  "削除に失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const MEMBER_ID_REQUIRED_MESSAGE =
  "削除するメンバーが指定されていません。画面を読み込み直してから、もう一度お試しください。";
const OWNER_NOT_REMOVABLE_MESSAGE =
  "代表（オーナー）は削除できません。";

const logError = (context: string, error: { code?: string; message?: string } | null | undefined) => {
  console.error(`[api/theater/members] ${context}`, { code: error?.code, message: error?.message });
};

// 本文が普通のオブジェクト（JSON の null・配列・文字列などではない）か。違うと payload.xxx で例外（500）になる
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
// 無い（undefined・null）か文字列か。数値などだと trim() で例外（500）になる
const isOptionalString = (value: unknown) =>
  value === undefined || value === null || typeof value === "string";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: LOGIN_REQUIRED_MESSAGE } },
      { status: 401 }
    );
  }

  const service = createSupabaseServiceClient();
  const resolved = await resolveActiveTheater(user.id);
  const member = resolved.activeMembership;

  if (!member || member.role !== "owner") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: OWNER_ONLY_MESSAGE } },
      { status: 403 }
    );
  }

  const { data: members, error } = await service
    .from("theater_members")
    .select("user_id, role")
    .eq("theater_id", member.theater_id);

  if (error) {
    logError("GET: theater_members の読み込みに失敗", error);
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: LOAD_FAILED_MESSAGE } },
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
      { error: { code: "INVALID_JSON", message: INVALID_BODY_MESSAGE } },
      { status: 400 }
    );
  }

  if (!isPlainObject(body)) {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: INVALID_BODY_MESSAGE } },
      { status: 400 }
    );
  }
  if (!isOptionalString(body.userId)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: MEMBER_ID_REQUIRED_MESSAGE } },
      { status: 400 }
    );
  }

  if (!body.userId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: MEMBER_ID_REQUIRED_MESSAGE } },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: LOGIN_REQUIRED_MESSAGE } },
      { status: 401 }
    );
  }

  const service = createSupabaseServiceClient();
  const resolved = await resolveActiveTheater(user.id);
  const member = resolved.activeMembership;

  if (!member || member.role !== "owner") {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: OWNER_ONLY_MESSAGE } },
      { status: 403 }
    );
  }

  // オーナー自身は削除不可
  if (body.userId === user.id) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: OWNER_NOT_REMOVABLE_MESSAGE } },
      { status: 403 }
    );
  }

  const { error: delError } = await service
    .from("theater_members")
    .delete()
    .eq("user_id", body.userId)
    .eq("theater_id", member.theater_id);

  if (delError) {
    logError("DELETE: theater_members の削除に失敗", delError);
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: DELETE_FAILED_MESSAGE } },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { deleted: true } });
}
