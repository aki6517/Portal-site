import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import TheaterStatusActions from "./TheaterStatusActions";

type TheaterRow = {
  id: string;
  name: string;
  status: string;
  contact_email: string;
  website_url: string | null;
  updated_at: string;
  created_at: string;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export default async function AdminTheatersPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
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

  const filterStatus = searchParams?.status?.trim();
  let query = supabase
    .from("theaters")
    .select("id, name, status, contact_email, website_url, updated_at, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  if (filterStatus) {
    query = query.eq("status", filterStatus);
  }

  const { data } = await query;
  const theaters = (data ?? []) as TheaterRow[];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-bold">劇団ステータス管理</h1>
      <p className="mt-2 text-sm text-zinc-600">
        劇団の承認ステータスを確認・更新できます（直近300件）。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <Link
          href="/admin/theaters"
          className={`rounded-full border px-3 py-1 ${
            !filterStatus
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-200 text-zinc-600"
          }`}
        >
          すべて
        </Link>
        {["pending", "approved", "rejected", "suspended"].map((status) => (
          <Link
            key={status}
            href={`/admin/theaters?status=${status}`}
            className={`rounded-full border px-3 py-1 ${
              filterStatus === status
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 text-zinc-600"
            }`}
          >
            {status}
          </Link>
        ))}
        <Link
          href="/admin/contact"
          className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-600"
        >
          お問い合わせ管理へ
        </Link>
        <Link
          href="/admin/site-tags"
          className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-600"
        >
          計測タグ設定
        </Link>
      </div>

      <div className="mt-4 space-y-4">
        {theaters.length === 0 && (
          <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600">
            対象の劇団はありません。
          </div>
        )}

        {theaters.map((theater) => (
          <div
            key={theater.id}
            className="rounded-xl border border-zinc-200 p-5 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{theater.name}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {theater.contact_email}
                </div>
                {theater.website_url && (
                  <a
                    href={theater.website_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block text-xs text-blue-700 underline"
                  >
                    {theater.website_url}
                  </a>
                )}
              </div>
              <TheaterStatusActions id={theater.id} status={theater.status} />
            </div>
            <div className="mt-3 text-[11px] text-zinc-500">
              status: {theater.status} / created: {formatDate(theater.created_at)} /
              updated: {formatDate(theater.updated_at)} / id: {theater.id}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
