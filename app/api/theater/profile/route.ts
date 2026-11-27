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
const THEATER_NOT_REGISTERED_MESSAGE =
  "劇団の登録がまだ済んでいません。劇団の情報を登録してから、もう一度お試しください。";
const THEATER_NOT_FOUND_MESSAGE =
  "劇団の情報が見つかりませんでした。画面を読み込み直してから、もう一度お試しください。";
const THEATER_FIELDS_REQUIRED_MESSAGE =
  "劇団名と連絡先メール（正しい形のメールアドレス）を入力してください。";
const SAVE_FAILED_MESSAGE =
  "保存に失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const FIELD_TYPE_MESSAGE =
  "入力内容の形が正しくありません。画面を読み込み直してから、もう一度お試しください。";
const LOAD_FAILED_MESSAGE =
  "読み込みに失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";

const logError = (context: string, error: { code?: string; message?: string } | null | undefined) => {
  console.error(`[api/theater/profile] ${context}`, { code: error?.code, message: error?.message });
};

type TheaterProfilePayload = {
  name?: string;
  description?: string | null;
  contact_email?: string;
  website_url?: string | null;
};

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const normalizeUrl = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
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
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: LOGIN_REQUIRED_MESSAGE } },
      { status: 401 }
    );
  }

  const resolved = await resolveActiveTheater(user.id);
  if (!resolved.activeTheaterId) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: THEATER_NOT_REGISTERED_MESSAGE } },
      { status: 403 }
    );
  }

  const service = createSupabaseServiceClient();
  const { data: theater, error } = await service
    .from("theaters")
    .select("id, name, description, contact_email, website_url, status")
    .eq("id", resolved.activeTheaterId)
    .single();

  if (error || !theater) {
    if (error) logError("GET: theaters の読み込みに失敗", error);
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: error ? LOAD_FAILED_MESSAGE : THEATER_NOT_FOUND_MESSAGE,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data: {
      theater,
      member: resolved.activeMembership
        ? { role: resolved.activeMembership.role }
        : null,
    },
  });
}

export async function PATCH(req: Request) {
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

  const resolved = await resolveActiveTheater(user.id);
  if (!resolved.activeTheaterId || !resolved.activeMembership) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: THEATER_NOT_REGISTERED_MESSAGE } },
      { status: 403 }
    );
  }

  let payload: TheaterProfilePayload;
  try {
    payload = (await req.json()) as TheaterProfilePayload;
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
  if (!isOptionalString(payload.name) || !isOptionalString(payload.contact_email)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: THEATER_FIELDS_REQUIRED_MESSAGE } },
      { status: 400 }
    );
  }
  if (!isOptionalString(payload.description) || !isOptionalString(payload.website_url)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: FIELD_TYPE_MESSAGE } },
      { status: 400 }
    );
  }

  const name = payload.name?.trim() ?? "";
  const contactEmail = payload.contact_email?.trim() ?? "";
  const description = payload.description?.trim() || null;
  const websiteUrl = normalizeUrl(payload.website_url);

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

  const service = createSupabaseServiceClient();
  const { data: current, error: currentError } = await service
    .from("theaters")
    .select("id, name")
    .eq("id", resolved.activeTheaterId)
    .single();

  if (currentError || !current) {
    if (currentError) logError("PATCH: theaters の読み込みに失敗", currentError);
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: currentError ? SAVE_FAILED_MESSAGE : THEATER_NOT_FOUND_MESSAGE,
        },
      },
      { status: 500 }
    );
  }

  const { data: updated, error: updateError } = await service
    .from("theaters")
    .update({
      name,
      description,
      contact_email: contactEmail,
      website_url: websiteUrl,
    })
    .eq("id", current.id)
    .select("id, name, description, contact_email, website_url, status")
    .single();

  if (updateError || !updated) {
    logError("PATCH: theaters の更新に失敗", updateError);
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

  if (current.name !== updated.name) {
    await service
      .from("events")
      .update({ company: updated.name })
      .eq("theater_id", current.id);
  }

  return NextResponse.json({ data: { theater: updated } });
}
