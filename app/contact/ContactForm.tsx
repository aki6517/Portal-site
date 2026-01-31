"use client";

import { useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

type Props = {
  siteKey: string;
};

const loadRecaptcha = (siteKey: string) =>
  new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("NOT_IN_BROWSER"));
      return;
    }
    if (window.grecaptcha) {
      resolve();
      return;
    }
    const scriptId = "recaptcha-v3";
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("RECAPTCHA_LOAD_FAILED"))
      );
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("RECAPTCHA_LOAD_FAILED"));
    document.head.appendChild(script);
  });

export default function ContactForm({ siteKey }: Props) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    message: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isConfigured = useMemo(() => Boolean(siteKey), [siteKey]);

  useEffect(() => {
    if (!siteKey) return;
    loadRecaptcha(siteKey).catch(() => {
      setMessage("reCAPTCHAの読み込みに失敗しました。");
    });
  }, [siteKey]);

  const submit = async () => {
    setMessage(null);
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      setMessage("お名前・メールアドレス・内容は必須です。");
      return;
    }
    if (!siteKey) {
      setMessage("reCAPTCHA未設定のため送信できません。");
      return;
    }

    setLoading(true);
    try {
      await loadRecaptcha(siteKey);
      const token = await new Promise<string>((resolve, reject) => {
        if (!window.grecaptcha) {
          reject(new Error("RECAPTCHA_NOT_READY"));
          return;
        }
        window.grecaptcha.ready(() => {
          window.grecaptcha
            ?.execute(siteKey, { action: "contact" })
            .then(resolve)
            .catch(reject);
        });
      });

      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          message: form.message,
          recaptcha_token: token,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json?.error?.message ?? "送信に失敗しました。");
        return;
      }
      if (json?.data?.email_sent === false) {
        setMessage(
          "送信を受け付けました。メール送信は未設定のため停止中です。"
        );
      } else {
        setMessage("送信を受け付けました。");
      }
      setForm({ name: "", email: "", message: "" });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "送信に失敗しました。"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 p-6">
      {!isConfigured && (
        <p className="mb-3 text-xs text-amber-600">
          reCAPTCHAが未設定のため、現在は送信できません。
        </p>
      )}
      <div className="grid gap-3 text-sm">
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="お名前"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="メールアドレス"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <textarea
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="お問い合わせ内容"
          rows={6}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
        />
      </div>
      <button
        onClick={submit}
        disabled={loading || !isConfigured}
        className="mt-4 w-full rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {loading ? "送信中..." : "送信する"}
      </button>
      {message && <p className="mt-2 text-xs text-zinc-600">{message}</p>}
    </div>
  );
}
