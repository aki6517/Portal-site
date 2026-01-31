"use client";

import { useState } from "react";

type Props = {
  id: string;
  status: string;
};

const STATUS_OPTIONS = [
  { value: "new", label: "未読" },
  { value: "read", label: "既読" },
  { value: "archived", label: "アーカイブ" },
];

export default function ContactRowActions({ id, status }: Props) {
  const [current, setCurrent] = useState(status);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const updateStatus = async (value: string) => {
    setLoading(true);
    setMessage(null);
    const res = await fetch(`/api/admin/contact/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: value }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json?.error?.message ?? "更新に失敗しました");
      setLoading(false);
      return;
    }
    setCurrent(value);
    setLoading(false);
  };

  return (
    <div className="flex items-center gap-2">
      <select
        className="rounded-md border border-zinc-200 px-2 py-1 text-xs"
        value={current}
        onChange={(e) => updateStatus(e.target.value)}
        disabled={loading}
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {message && <span className="text-xs text-amber-600">{message}</span>}
      {loading && <span className="text-xs text-zinc-500">更新中...</span>}
    </div>
  );
}
