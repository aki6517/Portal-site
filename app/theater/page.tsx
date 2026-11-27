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

// Supabase のログイン（メールのリンク・Google・ログアウト）の失敗を、劇団の人が読む日本語にする。
// 決め手は error.code（@supabase/auth-js の ErrorCode）・status・name で、英語の error.message は
// 画面に出さず console.error に残す。知らない失敗は、操作ごとの決まった文にする。
// （app/theater/page.tsx と app/register/page.tsx で同じ内容）
type AuthErrorLike =
  | { name?: string; code?: string; status?: number; message?: string }
  | null
  | undefined;
type AuthAction = "otp" | "oauth" | "signout";
const AUTH_FALLBACK_MESSAGES: Record<AuthAction, string> = {
  otp: "ログイン用のメールを送れませんでした。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。",
  oauth:
    "Googleでのログインを始められませんでした。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。",
  signout: "ログアウトできませんでした。時間をおいてもう一度お試しください。",
};
const describeAuthError = (error: AuthErrorLike, action: AuthAction) => {
  console.error(`[theater] ログインの操作（${action}）に失敗`, {
    name: error?.name,
    code: error?.code,
    status: error?.status,
    message: error?.message,
  });
  const code = error?.code ?? "";
  // 回数の制限（メールの送りすぎ・操作のしすぎ）
  if (code === "over_email_send_rate_limit") {
    return "ログイン用のメールを短い時間に送りすぎたため、いまは送れません。しばらく（数分〜1時間ほど）待ってから、もう一度お試しください。";
  }
  if (code === "over_request_rate_limit" || error?.status === 429) {
    return "短い時間にログインの操作が続いたため、いまは受け付けられません。しばらく待ってから、もう一度お試しください。";
  }
  // 通信の失敗（auth-js は通信断・502〜504 を AuthRetryableFetchError にする）
  if (error?.name === "AuthRetryableFetchError" || code === "request_timeout") {
    return "通信に失敗しました。インターネットへのつながりを確かめて、もう一度お試しください。";
  }
  if (action === "otp") {
    if (code === "email_address_invalid" || code === "validation_failed") {
      return "メールアドレスの形が正しくありません。入力し直してください。";
    }
    if (code === "email_address_not_authorized") {
      return "このメールアドレスには、いまログイン用のメールを送れません。福岡アクトポータル運営にお問い合わせください。";
    }
    if (code === "signup_disabled" || code === "otp_disabled" || code === "email_provider_disabled") {
      return "いまはメールでのログイン・新規登録を受け付けていません。福岡アクトポータル運営にお問い合わせください。";
    }
  }
  if (action === "oauth" && (code === "provider_disabled" || code === "oauth_provider_not_supported")) {
    return "いまは Google でのログインを使えません。メールのリンクでログインしてください。";
  }
  if (code === "captcha_failed") {
    return "確認に失敗しました。画面を読み込み直してから、もう一度お試しください。";
  }
  return AUTH_FALLBACK_MESSAGES[action];
};

// Google のログインやメールのリンクから、エラー付きで戻ってきたときの案内。
// signInWithOAuth は遷移の時点では error: null を返すので、Google 側でのキャンセルなどの失敗は、
// 戻り先の URL の error・error_code・error_description（クエリとハッシュの両方）に入る。
// 拾ったら URL から消す（再読み込みで同じ案内が出続けないように）。英語の error_description は console.error に残す。
// （app/theater/page.tsx と app/register/page.tsx で同じ内容）
const AUTH_REDIRECT_KEYS = ["error", "error_code", "error_description"] as const;
const takeAuthRedirectError = () => {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const pick = (key: string) => url.searchParams.get(key) ?? hash.get(key);
  const found = { error: pick("error"), code: pick("error_code"), description: pick("error_description") };
  if (!found.error && !found.code && !found.description) return null;
  for (const key of AUTH_REDIRECT_KEYS) {
    url.searchParams.delete(key);
    hash.delete(key);
  }
  const nextHash = hash.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${nextHash ? `#${nextHash}` : ""}`
  );
  return found;
};
const describeAuthRedirectError = (found: {
  error: string | null;
  code: string | null;
  description: string | null;
}) => {
  console.error("[theater] ログインの戻り先の URL にエラー", found);
  const code = found.code ?? "";
  if (code === "otp_expired") {
    return "ログイン用のリンクの期限が切れているか、すでに使われています。もう一度ログイン用のメールを送ってください。";
  }
  if (["flow_state_expired", "flow_state_not_found", "bad_oauth_state", "bad_oauth_callback", "bad_code_verifier"].includes(code)) {
    return "ログインの手続きの期限が切れたか、途中で止まりました。もう一度ログインしてください。";
  }
  if (code === "provider_disabled" || code === "oauth_provider_not_supported") {
    return "いまは Google でのログインを使えません。メールのリンクでログインしてください。";
  }
  if (code === "signup_disabled") {
    return "いまは新規登録を受け付けていません。福岡アクトポータル運営にお問い合わせください。";
  }
  if (code === "user_banned") {
    return "このアカウントではログインできません。福岡アクトポータル運営にお問い合わせください。";
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
    return "短い時間にログインの操作が続いたため、いまは受け付けられません。しばらく待ってから、もう一度お試しください。";
  }
  if (found.error === "access_denied") {
    return "Googleでのログインが完了しませんでした（キャンセルされたか、許可されませんでした）。もう一度お試しください。";
  }
  return "ログインできませんでした。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";
};

const EVENTS_LOAD_FAILED_MESSAGE =
  "読み込みに失敗しました。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";

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
  // 公演一覧の取得に失敗したとき（「まだ公演がありません」と見分けるため）
  const [eventsError, setEventsError] = useState<string | null>(null);
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

  // ログインの戻り先の URL のエラー（Google でのキャンセルなど）を拾って案内する
  useEffect(() => {
    const found = takeAuthRedirectError();
    if (found) setLoginMessage(describeAuthRedirectError(found));
  }, []);

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

      try {
        const eventsRes = await fetch("/api/theater/events", {
          cache: "no-store",
        });
        if (eventsRes.ok) {
          const eventsJson = (await eventsRes.json()) as {
            data?: { events: EventRow[] };
          };
          setEvents(eventsJson.data?.events ?? []);
        } else {
          const eventsJson = (await eventsRes.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setEventsError(eventsJson?.error?.message ?? EVENTS_LOAD_FAILED_MESSAGE);
        }
      } catch (err) {
        console.error("[theater] 公演一覧の読み込みに失敗", err);
        setEventsError(EVENTS_LOAD_FAILED_MESSAGE);
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
      setLoginMessage(describeAuthError(error, "oauth"));
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
      setLoginMessage(describeAuthError(error, "otp"));
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
      setLoginMessage(describeAuthError(error, "signout"));
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
        {/* ログアウトに失敗したときの文（ログイン後の画面には今まで出す場所が無かった） */}
        {loginMessage && (
          <p className="mt-4 text-xs text-red-700">エラー: {loginMessage}</p>
        )}
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
        {eventsError ? (
          <div className="rounded-2xl border-2 border-ink bg-surface p-6 text-sm text-red-700 shadow-hard-sm">
            {eventsError}
          </div>
        ) : events.length === 0 ? (
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
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-anywhere min-w-0 text-lg font-black">
                          {event.title}
                        </div>
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
                      <div className="text-anywhere mt-1 text-xs text-zinc-600">
                        {`URL: /events/${event.category}/${event.slug}`}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-sm">
                        <Link
                          href={`/events/${encodeURIComponent(
                            event.category
                          )}/${encodeURIComponent(event.slug)}/edit`}
                          className="btn-retro btn-ink"
                        >
                          編集
                        </Link>
                        {event.status === "published" && (
                          <Link
                            href={`/events/${encodeURIComponent(
                              event.category
                            )}/${encodeURIComponent(event.slug)}`}
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
