"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_OPTIONS = [
  { value: "pending", label: "審査中" },
  { value: "approved", label: "承認済み" },
  { value: "rejected", label: "差し戻し" },
  { value: "suspended", label: "停止中" },
] as const;

type Props = {
  id: string;
  status: string;
};

export default function TheaterStatusActions({ id, status }: Props) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState(status);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const update = async () => {
    if (nextStatus === status) {
      setMessage("変更なし");
      return;
    }
    setSaving(true);
    setMessage(null);
    const res = await fetch(`/api/admin/theaters/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    const json = (await res.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    if (!res.ok) {
      setMessage(json?.error?.message ?? "更新に失敗しました");
      setSaving(false);
      return;
    }
    setMessage("更新しました");
    setSaving(false);
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      <select
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
        value={nextStatus}
        onChange={(e) => setNextStatus(e.target.value)}
        disabled={saving}
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={update}
        disabled={saving}
        className="rounded-md border border-zinc-900 bg-zinc-900 px-2 py-1 text-xs text-white disabled:opacity-50"
      >
        {saving ? "更新中..." : "更新"}
      </button>
      {message && <span className="text-[11px] text-zinc-500">{message}</span>}
    </div>
  );
}
