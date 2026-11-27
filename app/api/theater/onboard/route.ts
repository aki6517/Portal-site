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
// 同じ名前の劇団がメンバー 0 人（運営が先に載せた劇団など）のとき。画面（app/register）はこの code を見て、引き継ぎの申し込み欄を出す
const THEATER_CLAIMABLE_MESSAGE =
  "この劇団は、福岡アクトポータル運営がすでに情報を載せています。下の『引き継ぎを申し込む』から申し込むと、運営が確認してから、あなたのアカウントをこの劇団の代表としてつなぎます。";
// 同じ名前の劇団にメンバーがいるとき（app/api/theater/claims の「メンバーがいる」と同じ文）。
// 『メンバー管理』『ログイン可能メールを追加』は app/register/page.tsx の代表（オーナー）向けの欄の見出し
const THEATER_HAS_MEMBERS_MESSAGE =
  "同じ名前の劇団がすでに登録されています。この劇団のメンバーになりたい場合は、劇団の代表の方に、劇団アカウント登録の画面の『メンバー管理』にある『ログイン可能メールを追加』から、あなたのメールアドレスを追加してもらってください。";

// 同じ名前の劇団を探す。劇団名の一意索引は lower(name)（docs/sql/003_update_theater_rules.sql の uniq_theaters_name_ci）。
// ilike は「%」「_」（と PostgREST が % に読み替える「*」）をワイルドカードにするので、そのまま渡すと別の名前にも一致する。
// 「\」「%」「_」は「\」を付けて文字そのものにし、「*」は 1 文字のワイルドカード「_」に置き換えて候補を絞り込み、
// 最後に「前後の空白を除いて小文字にした完全一致」で決める（候補は ilike の結果の中だけなので、ほかの劇団には一致しない）。
// 運営用の劇団の名前（自動収集の公演をまとめて入れる劇団。scripts/harvest/lib.mjs の EDITORIAL_COMPANY_NAME）。
// 劇団の登録にも引き継ぎにも使わせない。一覧と比べ方は lib/theater/claims.ts の RESERVED_THEATER_NAMES・isReservedTheaterName と同じ
// （既存の検査のローダーが新しい import を読めないため、ここは書き写し）。全角・半角・前後の空白・大文字小文字の違いは同じとみなす
const RESERVED_THEATER_NAMES = ["福岡アクトポータル編集部（外部情報）"];
const normalizeReservedName = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const isReservedTheaterName = (value: string) =>
  RESERVED_THEATER_NAMES.some((reserved) => normalizeReservedName(reserved) === normalizeReservedName(value));
const THEATER_NAME_RESERVED_MESSAGE =
  "この名前は福岡アクトポータル運営用のため使えません。別の劇団名で登録してください。";

const escapeLikePattern = (value: string) =>
  value.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, "_");
const normalizeTheaterName = (value: string) => value.trim().toLowerCase();
const SAME_NAME_CANDIDATE_LIMIT = 20;

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

  // 運営用の劇団の名前は、その劇団がまだ無くても使わせない（使えると、自動収集の公演がその人の劇団に入ってしまう）
  if (isReservedTheaterName(name)) {
    return NextResponse.json(
      {
        error: {
          code: "THEATER_NAME_RESERVED",
          message: THEATER_NAME_RESERVED_MESSAGE,
        },
      },
      { status: 409 }
    );
  }

  const service = createSupabaseServiceClient();

  const { data: sameNameCandidates, error: theaterCheckError } = await service
    .from("theaters")
    .select("id, name")
    .ilike("name", escapeLikePattern(name))
    .order("created_at", { ascending: true })
    .limit(SAME_NAME_CANDIDATE_LIMIT);

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

  const normalizedName = normalizeTheaterName(name);
  const existingTheater = ((sameNameCandidates ?? []) as { id: string; name: string | null }[]).find(
    (theater) => typeof theater.name === "string" && normalizeTheaterName(theater.name) === normalizedName
  );

  if (existingTheater) {
    // メンバーがいるかどうかで分ける（いるかどうかだけ分かればよいので 1 行だけ読む）
    const { data: existingMembers, error: memberCheckError } = await service
      .from("theater_members")
      .select("user_id")
      .eq("theater_id", existingTheater.id)
      .limit(1);

    if (memberCheckError || !Array.isArray(existingMembers)) {
      logError("同じ名前の劇団の theater_members の読み込みに失敗", memberCheckError);
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: describeOnboardDbError(memberCheckError),
          },
        },
        { status: 500 }
      );
    }

    if (existingMembers.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "THEATER_CLAIMABLE",
            message: THEATER_CLAIMABLE_MESSAGE,
          },
          data: {
            theater: { id: existingTheater.id, name: existingTheater.name },
          },
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "THEATER_NAME_EXISTS",
          message: THEATER_HAS_MEMBERS_MESSAGE,
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
    // 上の確認のあとに同じ名前（小文字にして同じ）の劇団ができた（同時に登録された）とき。
    // 劇団名の一意索引 uniq_theaters_name_ci にぶつかったときだけ、同じ名前の 409 にする（ほかの一意制約は 500 のまま）
    const uniqueText = `${theaterError?.message ?? ""} ${theaterError?.details ?? ""}`;
    if (theaterError?.code === "23505" && uniqueText.includes("uniq_theaters_name_ci")) {
      return NextResponse.json(
        {
          error: {
            code: "THEATER_NAME_EXISTS",
            message: THEATER_HAS_MEMBERS_MESSAGE,
          },
        },
        { status: 409 }
      );
    }
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
