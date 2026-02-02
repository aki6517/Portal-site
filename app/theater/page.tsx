"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type MeData = {
  theater: { id: string; name: string; status: string } | null;
  member: { role: string } | null;
};

type EventRow = {
  id: string;
  title: string;
  category: string;
  slug: string;
  status: string;
  start_date: string;
};

export default function TheaterDashboardPage() {
  const supabase = createSupabaseBrowserClient();
  const [me, setMe] = useState<MeData | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<
    "loading" | "loggedOut" | "loggedIn"
  >("loading");
  const [email, setEmail] = useState("");
  const [loginStatus, setLoginStatus] = useState<"idle" | "loading" | "sent">(
    "idle"
  );
  const [loginMessage, setLoginMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const res = await fetch("/api/theater/me", { cache: "no-store" });
      if (res.status === 401) {
        setAuthState("loggedOut");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("読み込みに失敗しました。");
        setLoading(false);
        return;
      }
      const json = (await res.json()) as { data?: MeData };
      setMe(json.data ?? null);
      setAuthState("loggedIn");

      const eventsRes = await fetch("/api/theater/events", {
        cache: "no-store",
      });
      if (eventsRes.ok) {
        const eventsJson = (await eventsRes.json()) as {
          data?: { events: EventRow[] };
        };
        setEvents(eventsJson.data?.events ?? []);
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  const signInWithGoogle = async () => {
    setLoginMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/theater`,
      },
    });
    if (error) {
      setLoginMessage(error.message);
    }
  };

  const signInWithMagicLink = async () => {
    setLoginStatus("loading");
    setLoginMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/theater`,
      },
    });
    if (error) {
      setLoginMessage(error.message);
      setLoginStatus("idle");
      return;
    }
    setLoginStatus("sent");
  };

  if (loading) {
    return <div className="text-sm text-zinc-600">読み込み中...</div>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600">
        {error}
      </div>
    );
  }

  if (authState === "loggedOut") {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-sm">
          <div className="font-semibold">劇団ログイン</div>
          <p className="mt-2 text-zinc-600">
            ログイン → 劇団情報入力 → 公演管理の順で進めます。
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 p-6">
          <button
            onClick={signInWithGoogle}
            className="w-full rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Googleでログイン
          </button>

          <div className="mt-4 rounded-lg border border-zinc-200 p-4 text-sm">
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
              disabled={!email || loginStatus === "loading"}
              className="mt-3 w-full rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
            >
              {loginStatus === "loading"
                ? "送信中..."
                : "メールリンクでログイン"}
            </button>
            {loginStatus === "sent" && (
              <p className="mt-2 text-xs text-green-600">
                ログインリンクを送信しました。メールをご確認ください。
              </p>
            )}
          </div>

          {loginMessage && (
            <p className="mt-3 text-xs text-red-600">エラー: {loginMessage}</p>
          )}
        </div>

        <div className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-600">
          まだ劇団登録が済んでいない場合は{" "}
          <Link href="/register" className="underline">
            /register
          </Link>{" "}
          から登録できます。
        </div>
      </div>
    );
  }

  if (authState === "loggedIn" && !me?.theater) {
    return (
      <div className="rounded-xl border border-zinc-200 p-6 text-sm">
        劇団情報が未登録です。{" "}
        <Link href="/register" className="underline">
          /register
        </Link>{" "}
        から登録してください。
      </div>
    );
  }

  const theater = me?.theater;
  if (!theater) {
    return (
      <div className="rounded-xl border border-zinc-200 p-6 text-sm text-zinc-600">
        読み込みに失敗しました。時間をおいて再度お試しください。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {theater.status !== "approved" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          劇団は現在「{theater.status}」です。公開はできませんが下書きの作成・編集は可能です。
        </div>
      )}
      <div className="rounded-xl border border-zinc-200 p-6">
        <h2 className="text-lg font-semibold">ダッシュボード</h2>
        <p className="mt-2 text-sm text-zinc-600">
          公演の作成・編集・非公開・削除ができます。
        </p>
        <Link
          className="mt-4 inline-block rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm text-white"
          href="/theater/events/new"
        >
          新規公演を作成
        </Link>
      </div>

      <div className="rounded-xl border border-zinc-200 p-6">
        <h3 className="text-base font-semibold">公演一覧</h3>
        <div className="mt-4 space-y-3 text-sm">
          {events.length === 0 && (
            <div className="text-zinc-600">公演がまだありません。</div>
          )}
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2"
            >
              <div>
                <div className="font-medium">{event.title}</div>
                <div className="text-xs text-zinc-500">
                  {event.category} / {event.slug} / {event.status}
                </div>
              </div>
              <Link
                href={`/theater/events/${event.id}`}
                className="text-xs text-zinc-900 underline"
              >
                編集
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
