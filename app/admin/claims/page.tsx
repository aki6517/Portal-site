import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { throwIfSupabaseError } from "@/lib/data/supabaseError";
import { isReservedTheaterName } from "@/lib/theater/claims";
import ClaimActions from "./ClaimActions";

// 劇団の引き継ぎの申し込み（public.theater_claims）の一覧。運営者だけ。
// theater_claims は RLS 有効・ポリシーなし（service_role だけ）なので、運営者の確認（cookie のクライアントで admins を読む）の
// あとに service_role で読む（app/admin/events と同じ作り）。
type ClaimRow = {
  id: string;
  theater_id: string;
  email: string;
  applicant_name: string | null;
  role_note: string | null;
  message: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
};

const CLAIM_COLUMNS =
  "id, theater_id, email, applicant_name, role_note, message, status, created_at, decided_at";

const STATUS_LABELS: Record<string, string> = {
  pending: "確認待ち",
  approved: "承認済み",
  rejected: "見送り",
  cancelled: "本人が取り消し",
};

const formatDateSafe = (value?: string | null) => {
  if (!value || value.trim().length === 0) return "未設定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
};

const orNone = (value: string | null) =>
  value && value.trim().length > 0 ? value : "（未記入）";

export default async function AdminClaimsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-zinc-600">
        ログインが必要です。
      </div>
    );
  }

  const { data: me } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!me) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-zinc-600">
        管理者権限がありません。
      </div>
    );
  }

  const service = createSupabaseServiceClient();
  const [pendingResult, decidedResult] = await Promise.all([
    service
      .from("theater_claims")
      .select(CLAIM_COLUMNS)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(200),
    service
      .from("theater_claims")
      .select(CLAIM_COLUMNS)
      .neq("status", "pending")
      .order("decided_at", { ascending: false, nullsFirst: false })
      .limit(20),
  ]);
  // 取得のエラーを「申し込みはありません」と見せない（エラー画面にする）
  throwIfSupabaseError("admin-claims:pending", pendingResult.error);
  throwIfSupabaseError("admin-claims:decided", decidedResult.error);
  const pending = (pendingResult.data ?? []) as ClaimRow[];
  const decided = (decidedResult.data ?? []) as ClaimRow[];

  const theaterIds = Array.from(
    new Set([...pending, ...decided].map((claim) => claim.theater_id))
  );
  const theaterNames = new Map<string, string>();
  if (theaterIds.length > 0) {
    const { data: theaters, error: theatersError } = await service
      .from("theaters")
      .select("id, name")
      .in("id", theaterIds);
    throwIfSupabaseError("admin-claims:theaters", theatersError);
    for (const theater of (theaters ?? []) as { id: string; name: string }[]) {
      theaterNames.set(theater.id, theater.name);
    }
  }

  // 確認待ちの劇団ごとの公演数（下書き・非公開も含む）。読めなかったら「不明」と出す（一覧は止めない）
  const pendingTheaterIds = Array.from(new Set(pending.map((claim) => claim.theater_id)));
  const eventCounts = new Map<string, number | null>(
    await Promise.all(
      pendingTheaterIds.map(async (theaterId) => {
        const { count, error } = await service
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("theater_id", theaterId);
        if (error) {
          console.error("[admin/claims] 公演数の読み込みに失敗", { code: error.code, message: error.message, theaterId });
        }
        const valid = !error && typeof count === "number" && Number.isInteger(count) && count >= 0;
        return [theaterId, valid ? count : null] as [string, number | null];
      })
    )
  );
  const nameOf = (theaterId: string) => theaterNames.get(theaterId) ?? "（劇団が見つかりません）";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold">引き継ぎの申し込み</h1>
      <p className="mt-2 text-sm text-zinc-600">
        運営が先に載せた劇団（メンバーが 0 人の劇団）の代表になりたい人からの申し込みです。承認すると、申し込んだ人がその劇団の代表（owner）になり、同じ劇団へのほかの申し込みは見送りになります。結果は申し込んだ人にメールで知らせます。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <Link
          href="/admin/theaters"
          className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-600"
        >
          劇団ステータス管理
        </Link>
        <Link
          href="/admin/contact"
          className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-600"
        >
          お問い合わせ管理
        </Link>
        <Link
          href="/admin/claims"
          className="rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1 text-white"
        >
          引き継ぎの申し込み（{pending.length}件）
        </Link>
      </div>

      <h2 className="mt-8 text-lg font-bold">確認待ち（{pending.length}件）</h2>
      <div className="mt-3 space-y-4">
        {pending.length === 0 && (
          <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600">
            確認待ちの申し込みはありません。
          </div>
        )}
        {pending.map((claim) => {
          const eventCount = eventCounts.get(claim.theater_id);
          return (
            <div
              key={claim.id}
              className="rounded-xl border border-zinc-200 p-5 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{nameOf(claim.theater_id)}</div>
                  {isReservedTheaterName(theaterNames.get(claim.theater_id)) && (
                    <div className="mt-1 text-xs font-semibold text-red-700">
                      運営用の劇団です（自動で集めた公演をまとめる劇団）。承認できないので、見送ってください。
                    </div>
                  )}
                  <div className="mt-1 text-xs text-zinc-500">
                    公演数: {eventCount === null || eventCount === undefined ? "不明" : `${eventCount}件`}
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-zinc-700">
                    <dt className="text-zinc-500">メール</dt>
                    <dd className="break-all">{claim.email}</dd>
                    <dt className="text-zinc-500">お名前</dt>
                    <dd>{orNone(claim.applicant_name)}</dd>
                    <dt className="text-zinc-500">劇団での立場</dt>
                    <dd>{orNone(claim.role_note)}</dd>
                    <dt className="text-zinc-500">ひとこと</dt>
                    <dd className="whitespace-pre-wrap">{orNone(claim.message)}</dd>
                    <dt className="text-zinc-500">申し込んだ日時</dt>
                    <dd>{formatDateSafe(claim.created_at)}</dd>
                  </dl>
                </div>
                <ClaimActions
                  id={claim.id}
                  theaterName={nameOf(claim.theater_id)}
                  email={claim.email}
                />
              </div>
              <div className="mt-3 text-[11px] text-zinc-500">
                申し込みID: {claim.id} / 劇団ID: {claim.theater_id}
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="mt-10 text-lg font-bold">処理済み（新しい順・{decided.length}件まで表示）</h2>
      <div className="mt-3 space-y-2">
        {decided.length === 0 && (
          <div className="rounded-xl border border-zinc-200 p-4 text-xs text-zinc-600">
            処理済みの申し込みはまだありません。
          </div>
        )}
        {decided.map((claim) => (
          <div
            key={claim.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 px-4 py-3 text-xs text-zinc-700"
          >
            <div className="min-w-0">
              <span className="font-semibold">{nameOf(claim.theater_id)}</span>
              <span className="ml-2 break-all text-zinc-500">{claim.email}</span>
            </div>
            <div className="text-zinc-500">
              {STATUS_LABELS[claim.status] ?? claim.status} / {formatDateSafe(claim.decided_at ?? claim.created_at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
