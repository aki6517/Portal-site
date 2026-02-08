"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ProfileResponse = {
  data?: {
    theater?: {
      id: string;
      name: string;
      description: string | null;
      contact_email: string;
      website_url: string | null;
      status: string;
    };
  };
  error?: { code: string; message: string };
};

type FormState = {
  name: string;
  description: string;
  contact_email: string;
  website_url: string;
};

const emptyForm: FormState = {
  name: "",
  description: "",
  contact_email: "",
  website_url: "",
};

export default function TheaterSettingsPage() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/theater/profile", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as ProfileResponse | null;
      if (!res.ok || !json?.data?.theater) {
        setError(json?.error?.message ?? "プロフィールの取得に失敗しました。");
        setLoading(false);
        return;
      }
      const theater = json.data.theater;
      setForm({
        name: theater.name ?? "",
        description: theater.description ?? "",
        contact_email: theater.contact_email ?? "",
        website_url: theater.website_url ?? "",
      });
      setLoading(false);
    };

    void fetchProfile();
  }, []);

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    const res = await fetch("/api/theater/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const json = (await res.json().catch(() => null)) as ProfileResponse | null;
    if (!res.ok) {
      setError(json?.error?.message ?? "保存に失敗しました。");
      setSaving(false);
      return;
    }
    setMessage("更新しました。");
    setSaving(false);
  };

  if (loading) {
    return <div className="card-retro p-6 text-sm text-zinc-700">読み込み中...</div>;
  }

  if (error && !form.name && !form.contact_email) {
    return <div className="card-retro p-6 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="card-retro p-6">
        <h2 className="font-display text-xl">劇団情報の編集</h2>
        <p className="mt-2 text-sm text-zinc-700">
          劇団名、紹介、連絡先メール、公式サイトURLを更新できます。
        </p>
      </div>

      <div className="card-retro p-6">
        <div className="space-y-3 text-sm">
          <label className="text-xs font-black tracking-wide text-zinc-700">
            劇団名
          </label>
          <input
            className="input-retro"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="劇団名"
          />

          <label className="text-xs font-black tracking-wide text-zinc-700">
            劇団紹介
          </label>
          <textarea
            className="textarea-retro"
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="劇団紹介"
          />

          <label className="text-xs font-black tracking-wide text-zinc-700">
            連絡先メール
          </label>
          <input
            className="input-retro"
            value={form.contact_email}
            onChange={(e) => updateField("contact_email", e.target.value)}
            placeholder="contact@example.com"
            type="email"
          />

          <label className="text-xs font-black tracking-wide text-zinc-700">
            公式サイトURL
          </label>
          <input
            className="input-retro"
            value={form.website_url}
            onChange={(e) => updateField("website_url", e.target.value)}
            placeholder="https://example.com"
            type="url"
          />
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={submit}
            disabled={saving}
            className="btn-retro btn-ink disabled:opacity-50"
          >
            {saving ? "保存中..." : "変更を保存"}
          </button>
          <Link href="/theater" className="btn-retro btn-surface text-center">
            ダッシュボードに戻る
          </Link>
        </div>

        {message && <p className="mt-3 text-xs text-green-700">{message}</p>}
        {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}
