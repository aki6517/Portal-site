"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  id: string;
};

export default function EventDraftActions({ id }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState<"publish" | "archive" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const updateStatus = async (status: "published" | "archived") => {
    setSaving(status === "published" ? "publish" : "archive");
    setMessage(null);
    const res = await fetch(`/api/admin/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    if (!res.ok) {
      setMessage(json?.error?.message ?? "更新に失敗しました");
      setSaving(null);
      return;
    }
    setMessage(status === "published" ? "公開しました" : "却下しました");
    setSaving(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => updateStatus("published")}
          disabled={saving !== null}
          className="rounded-md border border-green-700 bg-green-700 px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          {saving === "publish" ? "公開中..." : "公開する"}
        </button>
        <button
          type="button"
          onClick={() => updateStatus("archived")}
          disabled={saving !== null}
          className="rounded-md border border-red-700 px-2 py-1 text-xs text-red-700 disabled:opacity-50"
        >
          {saving === "archive" ? "却下中..." : "却下"}
        </button>
      </div>
      {message && <span className="text-[11px] text-zinc-500">{message}</span>}
    </div>
  );
}
