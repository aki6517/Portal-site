"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type MeResponse = {
  data?: {
    theater: { id: string; name: string; status: string } | null;
    member: { role: string } | null;
  };
  error?: { code: string; message: string };
};

export default function RegisterPage() {
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse["data"] | null>(null);
  const [authState, setAuthState] = useState<
    "loading" | "loggedOut" | "loggedIn"
  >("loading");
  const [onboardMessage, setOnboardMessage] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [onboardForm, setOnboardForm] = useState({
    name: "",
    contact_email: "",
    website_url: "",
    description: "",
    sns_x_url: "",
    sns_instagram_url: "",
    sns_facebook_url: "",
  });

  useEffect(() => {
    const fetchMe = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserEmail(user?.email ?? null);
      const res = await fetch("/api/theater/me", { cache: "no-store" });
      if (res.status === 401) {
        setAuthState("loggedOut");
        return;
      }
      if (res.ok) {
        const json = (await res.json()) as MeResponse;
        setMe(json.data ?? null);
        setAuthState("loggedIn");
      }
    };
    fetchMe();
  }, []);

  const signInWithGoogle = async () => {
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/register`,
      },
    });
    if (error) {
      setMessage(error.message);
    }
  };

  const signInWithMagicLink = async () => {
    setStatus("loading");
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/register`,
      },
    });
    if (error) {
      setMessage(error.message);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  };

  const submitOnboarding = async () => {
    setOnboarding(true);
    setOnboardMessage(null);
    const res = await fetch("/api/theater/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(onboardForm),
    });
    const json = (await res.json()) as MeResponse & {
      error?: { code: string; message: string };
    };
    if (!res.ok) {
      const detail = json.error?.message ?? "登録に失敗しました";
      if (detail.includes("row-level security")) {
        setOnboardMessage(
          "ログイン状態が正しく反映されていない可能性があります。ログアウト→再ログイン後に再度お試しください。"
        );
      } else {
        setOnboardMessage(detail);
      }
      setOnboarding(false);
      return;
    }
    setOnboardMessage("劇団情報を送信しました。承認をお待ちください。");
    setOnboarding(false);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">劇団ログイン / オンボーディング</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Google OAuth または メールリンクでログインできます。
      </p>

      <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
        <div className="font-medium">
          状態:{" "}
          {authState === "loggedIn"
            ? "ログイン中"
            : authState === "loggedOut"
            ? "ログアウト中"
            : "確認中"}
        </div>
        {userEmail && (
          <div className="mt-1 text-zinc-600">メール: {userEmail}</div>
        )}
        {authState === "loggedIn" && (
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              setAuthState("loggedOut");
              setMe(null);
              setUserEmail(null);
            }}
            className="mt-3 rounded-md border border-zinc-200 px-3 py-1 text-xs hover:bg-white"
          >
            ログアウト
          </button>
        )}
      </div>

      {authState === "loggedIn" && me?.theater && (
        <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <div className="font-medium">ログイン済み</div>
          <div className="mt-1 text-zinc-600">
            劇団: {me.theater.name} / 状態: {me.theater.status}
          </div>
          <a
            href="/theater"
            className="mt-3 inline-block text-sm font-medium text-zinc-900 underline"
          >
            劇団ダッシュボードへ
          </a>
        </div>
      )}

      {authState === "loggedOut" && (
        <div className="mt-8 space-y-4">
          <button
            onClick={signInWithGoogle}
            className="w-full rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Googleでログイン
          </button>

          <div className="rounded-lg border border-zinc-200 p-4">
            <label className="text-xs text-zinc-600">メールアドレス</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              className="mt-2 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm"
            />
            <button
              onClick={signInWithMagicLink}
              disabled={!email || status === "loading"}
              className="mt-3 w-full rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
            >
              {status === "loading" ? "送信中..." : "メールリンクでログイン"}
            </button>
            {status === "sent" && (
              <p className="mt-2 text-xs text-green-600">
                ログインリンクを送信しました。メールをご確認ください。
              </p>
            )}
          </div>

          {message && (
            <p className="text-xs text-red-600">エラー: {message}</p>
          )}
        </div>
      )}

      {authState === "loggedIn" && !me?.theater && (
        <div className="mt-8 rounded-lg border border-zinc-200 p-4">
          <h2 className="text-lg font-semibold">劇団情報の登録</h2>
          <p className="mt-1 text-sm text-zinc-600">
            承認後に公演の公開が可能になります。
          </p>
          <div className="mt-4 space-y-3 text-sm">
            <input
              className="w-full rounded-md border border-zinc-200 px-3 py-2"
              placeholder="劇団名"
              value={onboardForm.name}
              onChange={(e) =>
                setOnboardForm({ ...onboardForm, name: e.target.value })
              }
            />
            <input
              className="w-full rounded-md border border-zinc-200 px-3 py-2"
              placeholder="連絡先メール"
              value={onboardForm.contact_email}
              onChange={(e) =>
                setOnboardForm({
                  ...onboardForm,
                  contact_email: e.target.value,
                })
              }
            />
            <input
              className="w-full rounded-md border border-zinc-200 px-3 py-2"
              placeholder="公式サイトURL（任意）"
              value={onboardForm.website_url}
              onChange={(e) =>
                setOnboardForm({
                  ...onboardForm,
                  website_url: e.target.value,
                })
              }
            />
            <textarea
              className="w-full rounded-md border border-zinc-200 px-3 py-2"
              placeholder="劇団紹介（任意）"
              value={onboardForm.description}
              onChange={(e) =>
                setOnboardForm({
                  ...onboardForm,
                  description: e.target.value,
                })
              }
            />
          </div>
          <button
            onClick={submitOnboarding}
            disabled={onboarding}
            className="mt-4 w-full rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {onboarding ? "送信中..." : "劇団情報を送信"}
          </button>
          {onboardMessage && (
            <p className="mt-2 text-xs text-zinc-600">{onboardMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}
