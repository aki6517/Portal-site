"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type MeData = {
  theater: { id: string; name: string; status: string } | null;
  member: { role: string } | null;
  theaters?: { id: string; name: string; status: string; role: string }[] | null;
  active_theater_id?: string | null;
};

type EventRow = {
  id: string;
  title: string;
  category: string;
  slug: string;
  status: string;
  start_date: string;
  end_date?: string | null;
  updated_at?: string | null;
  views_30?: number;
};

const getEventStatusCopy = (status: string) => {
  switch (status) {
    case "published":
      return { label: "公開中", bg: "bg-primary" };
    case "draft":
      return { label: "下書き", bg: "bg-surface" };
    case "archived":
      return { label: "非公開", bg: "bg-secondary" };
    default:
      return { label: status, bg: "bg-surface" };
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  });
  return formatter.format(date);
};

export default function TheaterDashboardPage() {
  const supabase = createSupabaseBrowserClient();
  const [me, setMe] = useState<MeData | null>(null);
  const [theaters, setTheaters] = useState<
    { id: string; name: string; status: string; role: string }[]
  >([]);
  const [activeTheaterId, setActiveTheaterId] = useState<string | null>(null);
  const [switchingTheater, setSwitchingTheater] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardMessage, setDashboardMessage] = useState<string | null>(null);
  const [authState, setAuthState] = useState<
    "loading" | "loggedOut" | "loggedIn"
  >("loading");
  const [email, setEmail] = useState("");
  const [loginStatus, setLoginStatus] = useState<"idle" | "loading" | "sent">(
    "idle"
  );
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

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
      const data = json.data ?? null;
      setMe(data);
      setTheaters(data?.theaters ?? []);
      setActiveTheaterId(data?.active_theater_id ?? null);
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

  const switchTheater = async (theaterId: string) => {
    if (!theaterId || theaterId === activeTheaterId) return;
    setSwitchingTheater(true);
    try {
      const res = await fetch("/api/theater/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theater_id: theaterId }),
      });
      if (!res.ok) {
        setDashboardMessage("劇団の切り替えに失敗しました。");
      } else {
        setActiveTheaterId(theaterId);
        window.location.reload();
      }
    } finally {
      setSwitchingTheater(false);
    }
  };

  const deleteEvent = async (eventId: string) => {
    if (!confirm("この公演を完全削除します。よろしいですか？")) return;
    setDashboardMessage(null);
    const res = await fetch(`/api/theater/events/${eventId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setDashboardMessage(json?.error?.message ?? "削除に失敗しました。");
      return;
    }
    setEvents((prev) => prev.filter((event) => event.id !== eventId));
    setDashboardMessage("削除しました。");
  };

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

  const signOut = async () => {
    setLoggingOut(true);
    setLoginMessage(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setLoginMessage(error.message);
      setLoggingOut(false);
      return;
    }
    location.href = "/theater";
  };

  if (loading) {
    return (
      <div className="card-retro p-6 text-sm text-zinc-700">読み込み中...</div>
    );
  }

  if (error) {
    return (
      <div className="card-retro p-6 text-sm text-zinc-700">{error}</div>
    );
  }

  if (authState === "loggedOut") {
    return (
      <div className="space-y-6">
        <div className="card-retro p-7">
          <div className="font-display text-2xl">劇団ログイン</div>
          <p className="mt-2 text-sm text-zinc-700">
            Google またはメールリンクでログインできます。
          </p>
        </div>

        <div className="card-retro p-7">
          <button
            onClick={signInWithGoogle}
            className="btn-retro btn-ink w-full"
          >
            Googleでログイン
          </button>

          <div className="mt-5 rounded-2xl border-2 border-ink bg-surface-muted p-5 text-sm shadow-hard-sm">
            <div className="text-xs font-black tracking-wide text-zinc-700">
              メールリンクでログイン
            </div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              className="input-retro mt-3"
            />
            <button
              onClick={signInWithMagicLink}
              disabled={!email || loginStatus === "loading"}
              className="btn-retro btn-surface mt-3 w-full disabled:opacity-50"
            >
              {loginStatus === "loading"
                ? "送信中..."
                : "メールリンクでログイン"}
            </button>
            {loginStatus === "sent" && (
              <p className="mt-3 text-xs text-green-700">
                ログインリンクを送信しました。メールをご確認ください。
              </p>
            )}
          </div>

          {loginMessage && (
            <p className="mt-4 text-xs text-red-700">エラー: {loginMessage}</p>
          )}
        </div>

        <div className="rounded-2xl border-2 border-dashed border-ink bg-surface p-6 text-sm text-zinc-700 shadow-hard-sm">
          劇団登録がまだの場合は{" "}
          <Link href="/register" className="link-retro">
            /register
          </Link>{" "}
          から登録できます。
        </div>
      </div>
    );
  }

  if (authState === "loggedIn" && !me?.theater) {
    return (
      <div className="card-retro p-7 text-sm">
        劇団情報が未登録です。{" "}
        <Link href="/register" className="link-retro">
          /register
        </Link>{" "}
        から登録してください。
      </div>
    );
  }

  const theater = me?.theater;
  if (!theater) {
    return (
      <div className="card-retro p-7 text-sm text-zinc-700">
        読み込みに失敗しました。時間をおいて再度お試しください。
      </div>
    );
  }

  const publishedCount = events.filter((e) => e.status === "published").length;
  const draftCount = events.filter((e) => e.status === "draft").length;
  const archivedCount = events.filter((e) => e.status === "archived").length;
  const views30Total = events.reduce((sum, e) => sum + (e.views_30 ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="card-retro p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-black tracking-wide text-zinc-700">
              劇団
            </div>
            <h2 className="font-display text-2xl">{theater.name}</h2>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="badge-retro bg-surface shadow-hard-sm">
                公開: {publishedCount}
              </span>
              <span className="badge-retro bg-surface shadow-hard-sm">
                下書き: {draftCount}
              </span>
              <span className="badge-retro bg-surface shadow-hard-sm">
                非公開: {archivedCount}
              </span>
              <span className="badge-retro bg-secondary shadow-hard-sm">
                30日PV合計: {views30Total}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/theater/settings" className="btn-retro btn-surface">
              劇団情報を編集
            </Link>
            <Link href="/theater/events/new" className="btn-retro btn-ink">
              新規公演を作成
            </Link>
            <button
              onClick={signOut}
              disabled={loggingOut}
              className="btn-retro btn-surface disabled:opacity-50"
            >
              {loggingOut ? "ログアウト中..." : "ログアウト"}
            </button>
          </div>
        </div>
      </div>

      {theaters.length > 1 && (
        <div className="card-retro p-5 text-sm text-zinc-700">
          <div className="text-xs font-black tracking-wide text-zinc-700">
            操作中の劇団
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <select
              className="input-retro max-w-xs"
              value={activeTheaterId ?? ""}
              onChange={(e) => switchTheater(e.target.value)}
              disabled={switchingTheater}
            >
              {theaters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {switchingTheater && (
              <span className="text-xs text-zinc-600">切り替え中...</span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h3 className="font-display text-xl">公演一覧</h3>
          <Link href="/events" className="text-sm">
            <span className="btn-retro btn-surface">公開サイトを見る</span>
          </Link>
        </div>

        {dashboardMessage && (
          <div className="rounded-2xl border-2 border-ink bg-surface p-4 text-sm text-zinc-700 shadow-hard-sm">
            {dashboardMessage}
          </div>
        )}
        {events.length === 0 ? (
          <div className="rounded-2xl border-2 border-ink bg-surface p-6 text-sm text-zinc-700 shadow-hard-sm">
            まだ公演がありません。「新規公演を作成」から追加できます。
          </div>
        ) : (
          <div className="grid gap-4">
            {events.map((event) => {
              const statusCopy = getEventStatusCopy(event.status);
              const views = event.views_30 ?? 0;
              return (
                <div key={event.id} className="card-retro p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-black">{event.title}</div>
                        <span
                          className={`badge-retro ${statusCopy.bg} shadow-hard-sm`}
                        >
                          {statusCopy.label}
                        </span>
                        <span className="badge-retro bg-surface shadow-hard-sm">
                          30日PV: {views}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-zinc-700">
                        {formatDate(event.start_date)}
                        {event.end_date
                          ? ` 〜 ${formatDate(event.end_date)}`
                          : ""}
                      </div>
                      <div className="mt-1 text-xs text-zinc-600">
                        URL: /events/{event.category}/{event.slug}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-sm">
                        <Link
                          href={`/theater/events/${event.id}`}
                          className="btn-retro btn-ink"
                        >
                          編集
                        </Link>
                        {event.status === "published" && (
                          <Link
                            href={`/events/${event.category}/${event.slug}`}
                            className="btn-retro btn-surface"
                            target="_blank"
                          >
                            公開ページ
                          </Link>
                        )}
                        <button
                          type="button"
                          className="btn-retro btn-surface border-red-600 text-red-700"
                          onClick={() => deleteEvent(event.id)}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
