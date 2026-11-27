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
const NOT_MEMBER_MESSAGE =
  "この劇団のメンバーではないため、この操作はできません。";
const OWNER_ONLY_MESSAGE =
  "この操作は、劇団の代表（オーナー）だけができます。";
const SAVE_FAILED_MESSAGE =
  "保存に失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const DELETE_FAILED_MESSAGE =
  "削除に失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const INVITE_EMAIL_REQUIRED_MESSAGE =
  "追加するメールアドレスを、正しい形で入力してください。";
const INVITE_ID_REQUIRED_MESSAGE =
  "削除する追加メールが指定されていません。画面を読み込み直してから、もう一度お試しください。";

const logError = (context: string, error: { code?: string; message?: string } | null | undefined) => {
  console.error(`[api/theater/invite] ${context}`, { code: error?.code, message: error?.message });
};

type InvitePayload = {
  email?: string;
  inviteId?: string;
};

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// 本文が普通のオブジェクト（JSON の null・配列・文字列などではない）か。違うと payload.xxx で例外（500）になる
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
// 無い（undefined・null）か文字列か。数値などだと trim() で例外（500）になる
const isOptionalString = (value: unknown) =>
  value === undefined || value === null || typeof value === "string";

export async function POST(req: Request) {
  let payload: InvitePayload;
  try {
    payload = (await req.json()) as InvitePayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: INVALID_BODY_MESSAGE } },
      { status: 400 }
    );
  }

  if (!isPlainObject(payload)) {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: INVALID_BODY_MESSAGE } },
      { status: 400 }
    );
  }
  if (!isOptionalString(payload.email)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: INVITE_EMAIL_REQUIRED_MESSAGE } },
      { status: 400 }
    );
  }

  const email = payload.email?.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: INVITE_EMAIL_REQUIRED_MESSAGE,
        },
      },
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

  if (!member) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: NOT_MEMBER_MESSAGE } },
      { status: 403 }
    );
  }

  if (member.role !== "owner") {
    return NextResponse.json(
      {
        error: { code: "FORBIDDEN", message: OWNER_ONLY_MESSAGE },
      },
      { status: 403 }
    );
  }

  const { count: memberCount } = await service
    .from("theater_members")
    .select("*", { count: "exact", head: true })
    .eq("theater_id", member.theater_id);

  const { count: inviteCount } = await service
    .from("theater_invites")
    .select("*", { count: "exact", head: true })
    .eq("theater_id", member.theater_id)
    .eq("status", "pending");

  if ((memberCount ?? 0) + (inviteCount ?? 0) >= 2) {
    return NextResponse.json(
      {
        error: {
          code: "LIMIT_REACHED",
          message: "この劇団に登録できるメールは最大2件までです",
        },
      },
      { status: 409 }
    );
  }

  const { error: inviteError } = await service
    .from("theater_invites")
    .insert({
      theater_id: member.theater_id,
      email,
      status: "pending",
    })
    .select("id")
    .single();

  if (inviteError) {
    if (inviteError.code === "23505") {
      return NextResponse.json(
        {
          error: {
            code: "ALREADY_EXISTS",
            message: "このメールはすでに追加されています",
          },
        },
        { status: 409 }
      );
    }
    logError("theater_invites の作成に失敗", inviteError);
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: SAVE_FAILED_MESSAGE,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { email } }, { status: 201 });
}

export async function DELETE(req: Request) {
  let payload: InvitePayload;
  try {
    payload = (await req.json()) as InvitePayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: INVALID_BODY_MESSAGE } },
      { status: 400 }
    );
  }

  if (!isPlainObject(payload)) {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: INVALID_BODY_MESSAGE } },
      { status: 400 }
    );
  }
  if (!isOptionalString(payload.inviteId)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: INVITE_ID_REQUIRED_MESSAGE } },
      { status: 400 }
    );
  }

  const inviteId = payload.inviteId;
  if (!inviteId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: INVITE_ID_REQUIRED_MESSAGE } },
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
      {
        error: { code: "FORBIDDEN", message: OWNER_ONLY_MESSAGE },
      },
      { status: 403 }
    );
  }

  const { error: delError } = await service
    .from("theater_invites")
    .delete()
    .eq("id", inviteId)
    .eq("theater_id", member.theater_id);

  if (delError) {
    logError("theater_invites の削除に失敗", delError);
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: DELETE_FAILED_MESSAGE,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { deleted: true } }, { status: 200 });
}
