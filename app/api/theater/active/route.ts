import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveActiveTheater, setActiveTheaterForUser } from "@/lib/theater/activeTheater";

// 劇団向けの画面は応答の error.message をそのまま表示するので、message は劇団の人が読んで次に何をすれば
// いいか分かる日本語にする（error.code と HTTP ステータスは機械が読む値なので変えない）。
// DB などのエラー文は応答に出さず、サーバーのログ（console.error）に code・message を残す。
const LOGIN_REQUIRED_MESSAGE =
  "ログインが必要です。ログインし直してから、もう一度お試しください。";
const INVALID_BODY_MESSAGE =
  "送られた内容を読み取れませんでした。画面を読み込み直してから、もう一度お試しください。";
const THEATER_ID_REQUIRED_MESSAGE =
  "切り替える劇団が指定されていません。画面を読み込み直してから、もう一度お試しください。";
const NOT_MEMBER_SWITCH_MESSAGE =
  "この劇団のメンバーではないため、切り替えられません。";

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
      { error: { code: "UNAUTHORIZED", message: LOGIN_REQUIRED_MESSAGE } },
      { status: 401 }
    );
  }

  let payload: { theater_id?: string };
  try {
    payload = (await req.json()) as { theater_id?: string };
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
  if (!isOptionalString(payload.theater_id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: THEATER_ID_REQUIRED_MESSAGE } },
      { status: 400 }
    );
  }

  const theaterId = payload.theater_id?.trim();
  if (!theaterId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: THEATER_ID_REQUIRED_MESSAGE } },
      { status: 400 }
    );
  }

  const result = await setActiveTheaterForUser(user.id, theaterId);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: NOT_MEMBER_SWITCH_MESSAGE } },
      { status: 403 }
    );
  }

  return NextResponse.json({ data: { active_theater_id: theaterId } });
}
