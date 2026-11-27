import { NextRequest, NextResponse, after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  RESERVED_THEATER_NAMES,
  isMailConfigured,
  isUuid,
  notifyClaimApproved,
  notifyClaimRejected,
  notifyClaimSuperseded,
} from "@/lib/theater/claims";

// 劇団の引き継ぎの申し込み（public.theater_claims）を運営が承認・見送りする API（管理画面 app/admin/claims から呼ぶ）。
// 運営者の確かめ方は app/api/admin/theaters/[id] などと同じ（cookie のクライアントで admins を読む）。
// theater_claims は RLS 有効・ポリシーなし、theater_members への書き込みも service_role だけなので、読み書きは service_role で行う。
// 承認は DB の関数 approve_theater_claim（supabase/migrations/20261127160022_theater_claims.sql）を 1 回呼ぶだけにする。
// 劇団の行のロックのもとで「確かめる → owner を入れる → approved → 同じ劇団のほかの確認待ちを rejected」が 1 トランザクションで行われ、
// 当てはまらなければ何も書かずに理由（result）が返る。見送りは「pending のときだけ rejected にする」1 文の更新で足りる。
// お知らせのメールは応答を返したあと（next/server の after。Vercel では waitUntil で関数の時間内は最後まで動く）に送る。
// 送れたかどうかは応答に入らない（失敗は lib/theater/claims.ts がログに残す）。応答の notification は「送る予定か」。
const ACTIONS = new Set(["approve", "reject"]);

const logError = (context: string, error: { code?: string; message?: string } | null | undefined) => {
  console.error(`[api/admin/claims] ${context}`, { code: error?.code, message: error?.message });
};

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

const STATUS_LABELS: Record<string, string> = {
  approved: "承認済み",
  rejected: "見送り",
  cancelled: "本人が取り消し",
};

const notificationFor = (to: string | null | undefined) =>
  isMailConfigured(to) ? ("scheduled" as const) : ("not_configured" as const);

type MailTarget = { id: string; email: string; applicant_name: string | null };
const isMailTarget = (value: unknown): value is MailTarget => {
  const v = value as Partial<MailTarget> | null;
  return typeof v?.id === "string" && typeof v.email === "string" && (v.applicant_name === null || v.applicant_name === undefined || typeof v.applicant_name === "string");
};

// DB の関数 approve_theater_claim の結果
type ApproveResult = {
  result?: string;
  status?: string;
  theater_name?: string | null;
  claim?: unknown;
  superseded?: unknown;
};

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
    return fail(401, "UNAUTHORIZED", "ログインが必要です。");
  }

  const { data: admin } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!admin) {
    return fail(403, "FORBIDDEN", "運営者だけが操作できます。");
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return fail(400, "INVALID_JSON", "送られた内容を読み取れませんでした。");
  }
  const action =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as { action?: unknown }).action
      : undefined;
  if (typeof action !== "string" || !ACTIONS.has(action)) {
    return fail(400, "VALIDATION_ERROR", "action は approve か reject を指定してください。");
  }

  if (!isUuid(id)) {
    return fail(404, "NOT_FOUND", "申し込みが見つかりませんでした。");
  }

  const service = createSupabaseServiceClient();

  if (action === "approve") {
    const { data, error } = await service.rpc("approve_theater_claim", {
      p_claim_id: id,
      p_decided_by: user.id,
      p_reserved_names: [...RESERVED_THEATER_NAMES],
    });
    if (error) {
      logError("approve_theater_claim に失敗", error);
      return fail(500, "DB_ERROR", "承認の保存に失敗しました。時間をおいてもう一度お試しください。");
    }
    const result = (data ?? {}) as ApproveResult;
    switch (result.result) {
      case "claim_not_found":
        return fail(404, "NOT_FOUND", "申し込みが見つかりませんでした。");
      case "theater_not_found":
        return fail(404, "NOT_FOUND", "申し込み先の劇団が見つかりませんでした。");
      case "not_pending":
        return fail(
          409,
          "ALREADY_DECIDED",
          `この申し込みはすでに処理されています（${STATUS_LABELS[result.status ?? ""] ?? result.status ?? "不明"}）。画面を読み込み直してください。`
        );
      case "not_admin":
        return fail(403, "FORBIDDEN", "運営者だけが操作できます。");
      case "theater_reserved":
        return fail(
          409,
          "THEATER_NOT_CLAIMABLE",
          "この劇団は運営用（自動で集めた公演をまとめる劇団）のため、承認できません。見送ってください。"
        );
      case "theater_has_members":
        return fail(
          409,
          "THEATER_HAS_MEMBERS",
          "この劇団にはすでにメンバーがいるため、承認できません。メンバーを確かめてから、必要なら見送ってください。"
        );
      case "approved":
        break;
      default:
        logError("approve_theater_claim の結果が読めない", { message: JSON.stringify(result).slice(0, 200) });
        return fail(500, "DB_ERROR", "承認の結果を確かめられませんでした。画面を読み込み直して、申し込みの状態を確かめてください。");
    }

    // ここまで来たら DB では承認が確定している。メールに要る値の形が違っても、承認は成功として返す（ログに残す）
    const theaterName = typeof result.theater_name === "string" ? result.theater_name : "";
    const approvedClaim = isMailTarget(result.claim) ? result.claim : null;
    const superseded = Array.isArray(result.superseded) ? result.superseded.filter(isMailTarget) : [];
    if (!approvedClaim) {
      logError("approve_theater_claim の結果に申し込んだ人のメールが無い", { message: id });
    }
    after(async () => {
      if (approvedClaim) await notifyClaimApproved(theaterName, approvedClaim);
      for (const other of superseded) {
        await notifyClaimSuperseded(theaterName, other);
      }
    });
    return NextResponse.json({
      data: {
        claim: { id, status: "approved" },
        superseded: superseded.length,
        notification: notificationFor(approvedClaim?.email),
      },
    });
  }

  // ---- 見送り
  const { data: claimData, error: claimError } = await service
    .from("theater_claims")
    .select("id, theater_id, email, applicant_name, status")
    .eq("id", id)
    .maybeSingle();
  if (claimError) {
    logError("theater_claims の読み込みに失敗", claimError);
    return fail(500, "DB_ERROR", "申し込みの読み込みに失敗しました。時間をおいてもう一度お試しください。");
  }
  if (!claimData) {
    return fail(404, "NOT_FOUND", "申し込みが見つかりませんでした。");
  }
  const claim = claimData as MailTarget & { theater_id: string; status: string };
  if (claim.status !== "pending") {
    return fail(
      409,
      "ALREADY_DECIDED",
      `この申し込みはすでに処理されています（${STATUS_LABELS[claim.status] ?? claim.status}）。画面を読み込み直してください。`
    );
  }

  const { data: theater, error: theaterError } = await service
    .from("theaters")
    .select("id, name")
    .eq("id", claim.theater_id)
    .maybeSingle();
  if (theaterError) {
    logError("theaters の読み込みに失敗", theaterError);
    return fail(500, "DB_ERROR", "劇団の読み込みに失敗しました。時間をおいてもう一度お試しください。");
  }
  const theaterName = String(theater?.name ?? "");

  // pending のときだけ rejected にする 1 文の更新（確かめたあとに承認・取り消しがあれば、0 行で 409）
  const { data: rejected, error: rejectError } = await service
    .from("theater_claims")
    .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: user.id })
    .eq("id", claim.id)
    .eq("status", "pending")
    .select("id, status")
    .maybeSingle();
  if (rejectError) {
    logError("theater_claims の見送りに失敗", rejectError);
    return fail(500, "DB_ERROR", "見送りの保存に失敗しました。時間をおいてもう一度お試しください。");
  }
  if (!rejected) {
    return fail(409, "ALREADY_DECIDED", "この申し込みはすでに処理されています。画面を読み込み直してください。");
  }
  after(async () => {
    await notifyClaimRejected(theaterName, claim);
  });
  return NextResponse.json({ data: { claim: rejected, notification: notificationFor(claim.email) } });
}
