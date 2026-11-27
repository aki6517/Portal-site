import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 劇団向けの画面は応答の error.message をそのまま表示するので、message は劇団の人が読んで次に何をすれば
// いいか分かる日本語にする（error.code と HTTP ステータスは機械が読む値なので変えない）。
// DB などのエラー文は応答に出さず、サーバーのログ（console.error）に code・message を残す。
const LOGIN_REQUIRED_MESSAGE =
  "ログインが必要です。ログインし直してから、もう一度お試しください。";
const INVALID_BODY_MESSAGE =
  "送られた内容を読み取れませんでした。画面を読み込み直してから、もう一度お試しください。";
const THEATER_FIELDS_REQUIRED_MESSAGE =
  "劇団名と連絡先メール（正しい形のメールアドレス）を入力してください。";
const SAVE_FAILED_MESSAGE =
  "保存に失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
// 行の権限（RLS）などで書き込みを断られたとき（PostgreSQL の 42501 insufficient_privilege）。
// ここの書き込みは service_role なので、劇団の人がログインし直しても直らない（鍵の設定などサーバー側の問題）。
// 運営への問い合わせを案内する。ログイン切れは上の 401（ログインし直しの案内）で返している。
// （app/register/page.tsx は、以前は応答の英語の文から "row-level security" を探して、ログインし直しを案内していた）
const PERMISSION_PROBLEM_MESSAGE =
  "登録の処理で権限の問題が起きました。お手数ですが、福岡アクトポータル運営にお問い合わせください。";
const describeOnboardDbError = (error: { code?: string } | null | undefined) =>
  error?.code === "42501" ? PERMISSION_PROBLEM_MESSAGE : SAVE_FAILED_MESSAGE;
const FIELD_TYPE_MESSAGE =
  "入力内容の形が正しくありません。画面を読み込み直してから、もう一度お試しください。";

const logError = (context: string, error: { code?: string; message?: string } | null | undefined) => {
  console.error(`[api/theater/onboard] ${context}`, { code: error?.code, message: error?.message });
};

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

// 本文が普通のオブジェクト（JSON の null・配列・文字列などではない）か。違うと payload.xxx で例外（500）になる
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
// 無い（undefined・null）か文字列か。数値などだと trim() で例外（500）になる
const isOptionalString = (value: unknown) =>
  value === undefined || value === null || typeof value === "string";

export async function POST(req: Request) {
  let payload: OnboardPayload;
  try {
    payload = (await req.json()) as OnboardPayload;
  } catch {
    return NextResponse.json(
      {
        error: { code: "INVALID_JSON", message: INVALID_BODY_MESSAGE },
      },
      { status: 400 }
    );
  }

  if (!isPlainObject(payload)) {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: INVALID_BODY_MESSAGE } },
      { status: 400 }
    );
  }
  if (!isOptionalString(payload.name) || !isOptionalString(payload.contact_email)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: THEATER_FIELDS_REQUIRED_MESSAGE } },
      { status: 400 }
    );
  }
  if (["website_url", "sns_x_url", "sns_instagram_url", "sns_facebook_url", "description", "logo_url"].some(
      (key) => !isOptionalString((payload as Record<string, unknown>)[key])
    )) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: FIELD_TYPE_MESSAGE } },
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
          message: THEATER_FIELDS_REQUIRED_MESSAGE,
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
      { error: { code: "UNAUTHORIZED", message: LOGIN_REQUIRED_MESSAGE } },
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
    logError("theaters の読み込みに失敗", theaterCheckError);
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: describeOnboardDbError(theaterCheckError),
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
    logError("theaters の作成に失敗", theaterError);
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: describeOnboardDbError(theaterError),
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
    logError("theater_members の作成に失敗", linkError);
    await service.from("theaters").delete().eq("id", theater.id);
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: describeOnboardDbError(linkError),
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { theater } }, { status: 201 });
}
