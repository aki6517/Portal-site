"use client";

import { useEffect, useState } from "react";

type SiteTagsData = {
  id?: number;
  head_tag?: string | null;
  body_start_tag?: string | null;
  body_end_tag?: string | null;
  updated_at?: string | null;
};

type ApiResponse = {
  data?: SiteTagsData;
  error?: { code?: string; message?: string };
};

export default function SiteTagsForm() {
  const [headTag, setHeadTag] = useState("");
  const [bodyStartTag, setBodyStartTag] = useState("");
  const [bodyEndTag, setBodyEndTag] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/site-tags", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as ApiResponse | null;
        if (!res.ok) {
          setError(json?.error?.message ?? "設定の取得に失敗しました。");
          setLoading(false);
          return;
        }
        const data = json?.data;
        setHeadTag(data?.head_tag ?? "");
        setBodyStartTag(data?.body_start_tag ?? "");
        setBodyEndTag(data?.body_end_tag ?? "");
        setUpdatedAt(data?.updated_at ?? null);
      } catch {
        setError("ネットワークエラーで取得に失敗しました。");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const res = await fetch("/api/admin/site-tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          head_tag: headTag,
          body_start_tag: bodyStartTag,
          body_end_tag: bodyEndTag,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "設定の保存に失敗しました。");
        setSaving(false);
        return;
      }
      setUpdatedAt(json?.data?.updated_at ?? null);
      setMessage("計測タグ設定を更新しました。");
    } catch {
      setError("ネットワークエラーで保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600">
        読み込み中...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 p-5 text-sm text-zinc-700">
        <p>
          ここで設定したタグは公開サイトで実行されます。scriptタグ・noscriptタグをそのまま貼り付けできます。
        </p>
        {updatedAt && (
          <p className="mt-2 text-xs text-zinc-500">最終更新: {updatedAt}</p>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 p-5 text-sm">
        <label className="text-xs font-semibold text-zinc-600">headタグ内</label>
        <textarea
          className="mt-2 min-h-40 w-full rounded-xl border border-zinc-300 p-3 font-mono text-xs"
          value={headTag}
          onChange={(e) => setHeadTag(e.target.value)}
          placeholder={"<!-- 例: GA4 / GTM script -->"}
        />
      </div>

      <div className="rounded-xl border border-zinc-200 p-5 text-sm">
        <label className="text-xs font-semibold text-zinc-600">
          body開始直後
        </label>
        <textarea
          className="mt-2 min-h-32 w-full rounded-xl border border-zinc-300 p-3 font-mono text-xs"
          value={bodyStartTag}
          onChange={(e) => setBodyStartTag(e.target.value)}
          placeholder={"<!-- 例: GTM noscript -->"}
        />
      </div>

      <div className="rounded-xl border border-zinc-200 p-5 text-sm">
        <label className="text-xs font-semibold text-zinc-600">body終了直前</label>
        <textarea
          className="mt-2 min-h-32 w-full rounded-xl border border-zinc-300 p-3 font-mono text-xs"
          value={bodyEndTag}
          onChange={(e) => setBodyEndTag(e.target.value)}
          placeholder={"<!-- 例: 追加計測タグ -->"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存する"}
        </button>
        {message && <p className="text-xs text-green-700">{message}</p>}
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}
