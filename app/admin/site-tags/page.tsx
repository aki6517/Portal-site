import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import SiteTagsForm from "./SiteTagsForm";

export default async function AdminSiteTagsPage() {
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold">計測タグ設定</h1>
      <p className="mt-2 text-sm text-zinc-600">
        head / body に挿入する計測タグを管理します。
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
          href="/admin/site-tags"
          className="rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1 text-white"
        >
          計測タグ設定
        </Link>
      </div>

      <div className="mt-4">
        <SiteTagsForm />
      </div>
    </div>
  );
}
