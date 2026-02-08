import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ContactRowActions from "./ContactRowActions";

type ContactRow = {
  id: string;
  name: string;
  email: string;
  message: string;
  status: string;
  created_at: string;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export default async function AdminContactPage({
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

  const onlyNew = searchParams?.status === "new";
  let query = supabase
    .from("contact_messages")
    .select("id, name, email, message, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (onlyNew) {
    query = query.eq("status", "new");
  }

  const { data } = await query;

  const messages = (data ?? []) as ContactRow[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold">お問い合わせ一覧</h1>
      <p className="mt-2 text-sm text-zinc-600">
        直近200件の問い合わせを表示しています。
      </p>

      <div className="mt-4 flex items-center gap-2 text-xs">
        <Link
          href="/admin/theaters"
          className="rounded-full border border-zinc-200 px-3 py-1 text-zinc-600"
        >
          劇団ステータス管理
        </Link>
        <Link
          href="/admin/contact"
          className={`rounded-full border px-3 py-1 ${
            onlyNew
              ? "border-zinc-200 text-zinc-600"
              : "border-zinc-900 bg-zinc-900 text-white"
          }`}
        >
          すべて
        </Link>
        <Link
          href="/admin/contact?status=new"
          className={`rounded-full border px-3 py-1 ${
            onlyNew
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-200 text-zinc-600"
          }`}
        >
          未読のみ
        </Link>
      </div>

      <div className="mt-4 space-y-4">
        {messages.length === 0 && (
          <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600">
            お問い合わせはまだありません。
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="rounded-xl border border-zinc-200 p-5 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{msg.name}</div>
              <div className="text-xs text-zinc-500">
                {formatDate(msg.created_at)}
              </div>
            </div>
            <div className="mt-1 text-xs text-zinc-500">{msg.email}</div>
            <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-700">
              {msg.message}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
              <span>
                status: {msg.status} / id: {msg.id}
              </span>
              <ContactRowActions id={msg.id} status={msg.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
