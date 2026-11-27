import { NextResponse, after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  CLAIM_NOTIFY_COOLDOWN_HOURS,
  CLAIM_PENDING_LIMIT,
  CLAIM_TEXT_LIMITS,
  RESERVED_THEATER_NAMES,
  THEATER_HAS_MEMBERS_MESSAGE,
  countChars,
  isUuid,
  notifyOpsOfClaim,
} from "@/lib/theater/claims";

// 劇団の引き継ぎの申し込み（public.theater_claims）。運営が先に載せた、メンバーが 0 人の劇団の代表になりたい人が申し込む。
// 表は RLS 有効・ポリシーなし（service_role だけ）なので、ログインの確認は cookie のクライアント、読み書きは service_role で行う。
// 申し込みの作成は DB の関数 create_theater_claim（supabase/migrations/20261127160022_theater_claims.sql）に任せる。
// 確かめる（劇団・運営用・本人がメンバー・メンバー0人・同じ劇団の確認待ち・3件の上限）から作るまでが 1 トランザクションで、
// 同じ人の申し込みと、同じ劇団の承認とは 1 本ずつになる。
// 劇団向けの画面は応答の error.message をそのまま表示するので、message は劇団の人が読んで次に何をすれば
// いいか分かる日本語にする（error.code と HTTP ステータスは機械が読む値なので変えない）。
// DB などのエラー文は応答に出さず、サーバーのログ（console.error）に code・message を残す。
const LOGIN_REQUIRED_MESSAGE =
  "ログインが必要です。ログインし直してから、もう一度お試しください。";
const INVALID_BODY_MESSAGE =
  "送られた内容を読み取れませんでした。画面を読み込み直してから、もう一度お試しください。";
const FIELD_TYPE_MESSAGE =
  "入力内容の形が正しくありません。画面を読み込み直してから、もう一度お試しください。";
const THEATER_ID_REQUIRED_MESSAGE =
  "引き継ぎを申し込む劇団が指定されていません。画面を読み込み直してから、もう一度お試しください。";
const CLAIM_ID_REQUIRED_MESSAGE =
  "取り消す申し込みが指定されていません。画面を読み込み直してから、もう一度お試しください。";
const TOO_LONG_MESSAGES = {
  applicant_name: `お名前は${CLAIM_TEXT_LIMITS.applicant_name}文字以内で入力してください。`,
  role_note: `劇団での立場は${CLAIM_TEXT_LIMITS.role_note}文字以内で入力してください。`,
  message: `ひとことは${CLAIM_TEXT_LIMITS.message}文字以内で入力してください。`,
} as const;
const EMAIL_MISSING_MESSAGE =
  "ログインしているアカウントのメールアドレスが確認できませんでした。メールアドレスでログインし直してから、もう一度お試しください。";
const THEATER_NOT_FOUND_MESSAGE =
  "劇団が見つかりませんでした。画面を読み込み直してから、もう一度お試しください。";
const ALREADY_MEMBER_MESSAGE = "すでにこの劇団のメンバーです。";
const ACCOUNT_GONE_MESSAGE =
  "ログインしているアカウントが見つかりませんでした。ログインし直してから、もう一度お試しください。";
const RESERVED_THEATER_MESSAGE =
  "この劇団は福岡アクトポータル運営用（自動で集めた公演をまとめる劇団）のため、引き継ぎの申し込みはできません。ご自身の劇団名で登録してください。";
const TOO_MANY_PENDING_MESSAGE = `確認待ちの引き継ぎの申し込みは、同時に${CLAIM_PENDING_LIMIT}件までです。運営の確認が終わるまでお待ちいただくか、今の申し込みを取り消してから、もう一度お試しください。`;
const RATE_LIMITED_MESSAGE =
  "短い時間に何度も送られました。1分ほど待ってから、もう一度お試しください。";
const SAVE_FAILED_MESSAGE =
  "保存に失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const LOAD_FAILED_MESSAGE =
  "読み込みに失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
const CANCEL_NOT_FOUND_MESSAGE =
  "取り消せる申し込みが見つかりませんでした（すでに運営が確認したか、取り消し済みです）。画面を読み込み直してください。";

const logError = (context: string, error: { code?: string; message?: string } | null | undefined) => {
  console.error(`[api/theater/claims] ${context}`, { code: error?.code, message: error?.message });
};

// メモリ上のレート制限（app/api/contact・app/api/ai/generate-promotion と同じ形。1分に5回まで）。
// ログインが必要な API なので、利用者ごとに数える。インスタンスごとの目安で、上限の保証ではない
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const checkRateLimit = (key: string) => {
  const now = Date.now();
  const existing = rateLimitStore.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
    return { ok: false, retryAfter };
  }
  existing.count += 1;
  rateLimitStore.set(key, existing);
  return { ok: true, retryAfter: 0 };
};

// 本文が普通のオブジェクト（JSON の null・配列・文字列などではない）か。違うと payload.xxx で例外（500）になる
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
// 無い（undefined・null）か文字列か。数値などだと trim() で例外（500）になる
const isOptionalString = (value: unknown): value is string | null | undefined =>
  value === undefined || value === null || typeof value === "string";
// 空白だけ・空は「書いていない」（null）として保存する
const toOptionalText = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const CLAIM_COLUMNS = "id, theater_id, status, created_at, decided_at, applicant_name, role_note, message";

type ClaimRow = {
  id: string;
  theater_id: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  applicant_name: string | null;
  role_note: string | null;
  message: string | null;
};

const toClaimResponse = (claim: ClaimRow, theaterName: string | null) => ({
  id: claim.id,
  theater_id: claim.theater_id,
  theater_name: theaterName,
  status: claim.status,
  created_at: claim.created_at,
  decided_at: claim.decided_at,
  applicant_name: claim.applicant_name,
  role_note: claim.role_note,
  message: claim.message,
});

const getLoginUser = async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
};

const unauthorized = () =>
  NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: LOGIN_REQUIRED_MESSAGE } },
    { status: 401 }
  );

const badRequest = (code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status: 400 });

const dbError = (message: string) =>
  NextResponse.json({ error: { code: "DB_ERROR", message } }, { status: 500 });

// DB の関数 create_theater_claim の結果（supabase/migrations/20261127160022_theater_claims.sql）
type CreateClaimResult = {
  result?: string;
  theater_name?: string | null;
  claim?: (ClaimRow & { email?: string }) | null;
  should_notify?: boolean;
};

// 申し込む
export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return badRequest("INVALID_JSON", INVALID_BODY_MESSAGE);
  }
  if (!isPlainObject(payload)) {
    return badRequest("INVALID_JSON", INVALID_BODY_MESSAGE);
  }

  const { theater_id: theaterId, applicant_name, role_note, message } = payload;
  if (!isUuid(theaterId)) {
    return badRequest("VALIDATION_ERROR", THEATER_ID_REQUIRED_MESSAGE);
  }
  if (!isOptionalString(applicant_name) || !isOptionalString(role_note) || !isOptionalString(message)) {
    return badRequest("VALIDATION_ERROR", FIELD_TYPE_MESSAGE);
  }
  const fields = {
    applicant_name: toOptionalText(applicant_name),
    role_note: toOptionalText(role_note),
    message: toOptionalText(message),
  };
  for (const key of ["applicant_name", "role_note", "message"] as const) {
    const value = fields[key];
    if (value !== null && countChars(value) > CLAIM_TEXT_LIMITS[key]) {
      return badRequest("VALIDATION_ERROR", TOO_LONG_MESSAGES[key]);
    }
  }

  const user = await getLoginUser();
  if (!user) return unauthorized();

  const limit = checkRateLimit(user.id);
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: RATE_LIMITED_MESSAGE } },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const email = user.email?.trim();
  if (!email) {
    return badRequest("EMAIL_REQUIRED", EMAIL_MISSING_MESSAGE);
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("create_theater_claim", {
    p_theater_id: theaterId,
    p_user_id: user.id,
    p_email: email,
    p_applicant_name: fields.applicant_name,
    p_role_note: fields.role_note,
    p_message: fields.message,
    p_reserved_names: [...RESERVED_THEATER_NAMES],
    p_pending_limit: CLAIM_PENDING_LIMIT,
    p_notify_cooldown_hours: CLAIM_NOTIFY_COOLDOWN_HOURS,
  });

  if (error) {
    logError("POST: create_theater_claim に失敗", error);
    // 確かめたあとにアカウントや劇団が消えた（外部キーの違反）。制約の名前で分ける
    if (error.code === "23503") {
      const text = `${error.message ?? ""} ${error.details ?? ""}`;
      if (text.includes("theater_claims_user_id_fkey")) {
        return NextResponse.json(
          { error: { code: "UNAUTHORIZED", message: ACCOUNT_GONE_MESSAGE } },
          { status: 401 }
        );
      }
      if (text.includes("theater_claims_theater_id_fkey")) {
        return NextResponse.json(
          { error: { code: "NOT_FOUND", message: THEATER_NOT_FOUND_MESSAGE } },
          { status: 404 }
        );
      }
    }
    return dbError(SAVE_FAILED_MESSAGE);
  }

  const result = (data ?? {}) as CreateClaimResult;
  switch (result.result) {
    case "theater_not_found":
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: THEATER_NOT_FOUND_MESSAGE } },
        { status: 404 }
      );
    case "theater_reserved":
      return NextResponse.json(
        { error: { code: "THEATER_NOT_CLAIMABLE", message: RESERVED_THEATER_MESSAGE } },
        { status: 403 }
      );
    case "already_member":
      return NextResponse.json(
        { error: { code: "ALREADY_MEMBER", message: ALREADY_MEMBER_MESSAGE } },
        { status: 409 }
      );
    case "theater_has_members":
      return NextResponse.json(
        { error: { code: "THEATER_HAS_MEMBERS", message: THEATER_HAS_MEMBERS_MESSAGE } },
        { status: 409 }
      );
    case "too_many_pending":
      return NextResponse.json(
        { error: { code: "TOO_MANY_PENDING_CLAIMS", message: TOO_MANY_PENDING_MESSAGE } },
        { status: 409 }
      );
    case "already_pending":
    case "created":
      break;
    default:
      logError("POST: create_theater_claim の結果が読めない", { message: JSON.stringify(result).slice(0, 200) });
      return dbError(SAVE_FAILED_MESSAGE);
  }

  const claim = result.claim;
  if (!claim || typeof claim.id !== "string") {
    logError("POST: create_theater_claim の結果に申し込みが無い", { message: String(result.result) });
    return dbError(SAVE_FAILED_MESSAGE);
  }
  const theaterName = typeof result.theater_name === "string" ? result.theater_name : null;

  if (result.result === "already_pending") {
    return NextResponse.json({
      data: { claim: toClaimResponse(claim, theaterName), already_pending: true },
    });
  }

  // 運営に知らせる（応答を返したあとに送る。送れなくても申し込みは成功。失敗は lib/theater/claims.ts がログに残す）。
  // 同じ人・同じ劇団の申し込みが最近あったとき（取り消して出し直した）は知らせない
  if (result.should_notify === true) {
    const forMail = {
      id: claim.id,
      email,
      applicant_name: claim.applicant_name,
      role_note: claim.role_note,
      message: claim.message,
      created_at: claim.created_at,
    };
    const name = theaterName ?? "";
    after(async () => {
      await notifyOpsOfClaim(name, forMail);
    });
  }

  return NextResponse.json(
    { data: { claim: toClaimResponse(claim, theaterName), already_pending: false } },
    { status: 201 }
  );
}

// 自分の申し込み。確認待ち（上限 CLAIM_PENDING_LIMIT 件なので全部）と、処理済みの最近のものを分けて返す
const RECENT_DECIDED_LIMIT = 5;
export async function GET() {
  const user = await getLoginUser();
  if (!user) return unauthorized();

  const service = createSupabaseServiceClient();
  const [pendingResult, recentResult] = await Promise.all([
    service
      .from("theater_claims")
      .select(CLAIM_COLUMNS)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    service
      .from("theater_claims")
      .select(CLAIM_COLUMNS)
      .eq("user_id", user.id)
      .neq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(RECENT_DECIDED_LIMIT),
  ]);
  for (const [label, r] of [["確認待ち", pendingResult], ["処理済み", recentResult]] as const) {
    if (r.error || !Array.isArray(r.data)) {
      logError(`GET: theater_claims（${label}）の読み込みに失敗`, r.error);
      return dbError(LOAD_FAILED_MESSAGE);
    }
  }
  const pending = (pendingResult.data ?? []) as ClaimRow[];
  const recent = (recentResult.data ?? []) as ClaimRow[];

  const theaterIds = Array.from(new Set([...pending, ...recent].map((claim) => claim.theater_id)));
  const names = new Map<string, string>();
  if (theaterIds.length > 0) {
    const { data: theaters, error: theatersError } = await service
      .from("theaters")
      .select("id, name")
      .in("id", theaterIds);
    if (theatersError || !Array.isArray(theaters)) {
      logError("GET: theaters の読み込みに失敗", theatersError);
      return dbError(LOAD_FAILED_MESSAGE);
    }
    for (const theater of theaters as { id: string; name: string }[]) {
      names.set(theater.id, theater.name);
    }
  }
  const toResponse = (claim: ClaimRow) => toClaimResponse(claim, names.get(claim.theater_id) ?? null);

  return NextResponse.json({
    data: { pending: pending.map(toResponse), recent: recent.map(toResponse) },
  });
}

// 自分の確認待ちの申し込みを取り消す（cancelled にする）
export async function DELETE(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return badRequest("INVALID_JSON", INVALID_BODY_MESSAGE);
  }
  if (!isPlainObject(payload)) {
    return badRequest("INVALID_JSON", INVALID_BODY_MESSAGE);
  }
  const claimId = payload.claim_id;
  if (!isUuid(claimId)) {
    return badRequest("VALIDATION_ERROR", CLAIM_ID_REQUIRED_MESSAGE);
  }

  const user = await getLoginUser();
  if (!user) return unauthorized();

  const service = createSupabaseServiceClient();
  // 本人の・確認待ちのものだけを取り消す（運営が承認・見送りしたものは変えない）
  const { data: cancelled, error } = await service
    .from("theater_claims")
    .update({ status: "cancelled", decided_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("user_id", user.id)
    .eq("status", "pending")
    .select("id, status")
    .maybeSingle();
  if (error) {
    logError("DELETE: theater_claims の取り消しに失敗", error);
    return dbError(SAVE_FAILED_MESSAGE);
  }
  if (!cancelled) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: CANCEL_NOT_FOUND_MESSAGE } },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: { claim: cancelled } });
}
