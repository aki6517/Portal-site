import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import EventDraftActions from "./EventDraftActions";

type EventDraftRow = {
  id: string;
  title: string;
  company: string;
  category: string;
  start_date: string;
  end_date: string | null;
  venue: string | null;
  ai_confidence: number | null;
  source_urls: string[] | null;
  created_at: string;
};

// docs/sql/001_init.sql の categories シードと同じid→表示名の対応。
const CATEGORY_LABELS: Record<string, string> = {
  comedy: "コメディ",
  conversation: "会話劇",
  musical: "ミュージカル",
  classic: "古典・時代劇",
  dance: "ダンス",
  student: "学生演劇",
  conte: "コント",
  experimental: "実験的",
  other: "その他",
};

const getCategoryLabel = (category: string) => CATEGORY_LABELS[category] ?? category;

const formatDateSafe = (value?: string | null) => {
  if (!value || value.trim().length === 0) return "未設定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

// ai_confidence（0-1）のバッジ表示。0.8以上=緑、0.5以上=黄、それ未満=赤、未設定=グレー。
const getConfidenceBadge = (value: number | null) => {
  if (value === null || value === undefined) {
    return {
      label: "未設定",
      className: "border-zinc-300 bg-zinc-100 text-zinc-600",
    };
  }
  const pct = Math.round(value * 100);
  if (value >= 0.8) {
    return {
      label: `${pct}%`,
      className: "border-green-300 bg-green-50 text-green-800",
    };
  }
  if (value >= 0.5) {
    return {
      label: `${pct}%`,
      className: "border-yellow-300 bg-yellow-50 text-yellow-800",
    };
  }
  return {
    label: `${pct}%`,
    className: "border-red-300 bg-red-50 text-red-800",
  };
};

const getUrlLabel = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export default async function AdminEventsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const { data: me } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!me) {
    notFound();
  }

  // draft一覧はis_admin()のRLSでも読めるが、scout由来の下書きを取りこぼしなく
  // 確実に見せるためserviceクライアントで取得する（admin判定は上の cookie
  // クライアントで既に完了している）。
  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("events")
    .select(
      "id, title, company, category, start_date, end_date, venue, ai_confidence, source_urls, created_at"
    )
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("[admin/events] Failed to fetch draft events", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      userId: user.id,
    });
  }

  const drafts = (data ?? []) as EventDraftRow[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-bold">公演ドラフトレビュー</h1>
      <p className="mt-2 text-sm text-zinc-600">
        AIがWeb検索で収集した学生演劇などの公演下書きを確認し、公開または却下できます（直近300件）。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <Link
          href="/admin/theaters"
          className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-600"
        >
          劇団ステータス管理へ
        </Link>
        <Link
          href="/admin/contact"
          className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-600"
        >
          お問い合わせ管理へ
        </Link>
      </div>

      <div className="mt-4 space-y-4">
        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-6 text-sm text-red-800">
            下書きデータの読み込みに失敗しました。時間を置いて再度お試しください。
          </div>
        )}

        {!error && drafts.length === 0 && (
          <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600">
            レビュー待ちの下書きはありません。
          </div>
        )}

        {drafts.map((draft) => {
          const confidence = getConfidenceBadge(draft.ai_confidence);
          const sourceUrls = draft.source_urls ?? [];
          return (
            <div
              key={draft.id}
              className="rounded-xl border border-zinc-200 p-5 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{draft.title}</div>
                  <div className="mt-1 text-xs text-zinc-500">{draft.company}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-zinc-600">
                      {getCategoryLabel(draft.category)}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 ${confidence.className}`}
                    >
                      AI確度: {confidence.label}
                    </span>
                  </div>
                </div>
                <EventDraftActions id={draft.id} />
              </div>

              <div className="mt-3 text-[11px] text-zinc-500">
                会期: {formatDateSafe(draft.start_date)} 〜 {formatDateSafe(draft.end_date)} /
                会場: {draft.venue ?? "未設定"} / 登録日: {formatDateSafe(draft.created_at)}
              </div>

              {sourceUrls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                  {sourceUrls.map((url, idx) => (
                    <a
                      key={`${draft.id}-src-${idx}`}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 underline"
                    >
                      出典: {getUrlLabel(url)}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
