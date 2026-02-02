"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type MeResponse = {
  data?: {
    theater: { id: string; name: string; status: string } | null;
    member: { role: string } | null;
    stats?: {
      memberCount: number;
      inviteCount: number;
      totalAllowed: number;
    };
    invites?: { id: string; email: string; status: string; created_at: string }[];
    joinedFromInvite?: boolean;
    pendingInvite?: { id: string; theater_id: string } | null;
  };
  error?: { code: string; message: string };
};

const getTheaterStatusCopy = (status: string) => {
  switch (status) {
    case "pending":
      return { label: "運営確認中" };
    case "approved":
      return { label: "承認済み" };
    case "rejected":
      return { label: "差し戻し" };
    case "suspended":
      return { label: "停止中" };
    default:
      return { label: status };
  }
};

const getInviteStatusCopy = (status: string) => {
  switch (status) {
    case "pending":
      return { label: "未確認", tone: "text-amber-700", bg: "bg-amber-50" };
    case "accepted":
      return { label: "確認済み", tone: "text-green-700", bg: "bg-green-50" };
    case "revoked":
      return { label: "無効", tone: "text-zinc-600", bg: "bg-zinc-100" };
    default:
      return { label: status, tone: "text-zinc-700", bg: "bg-zinc-50" };
  }
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
  const [meCheckStatus, setMeCheckStatus] = useState<
    "idle" | "checking" | "ok" | "error"
  >("idle");
  const [meCheckMessage, setMeCheckMessage] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState<
    "idle" | "loading" | "sent" | "error"
  >("idle");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [inviteRemoveId, setInviteRemoveId] = useState<string | null>(null);
  const [members, setMembers] = useState<
    { user_id: string; role: string; email: string }[]
  >([]);
  const [memberRemoveId, setMemberRemoveId] = useState<string | null>(null);
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
    const refreshAuth = async () => {
      setMeCheckStatus("checking");
      setMeCheckMessage(null);
      setAuthState("loading");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUserEmail(null);
        setMe(null);
        setAuthState("loggedOut");
        setMeCheckStatus("ok");
        return;
      }

      setUserEmail(user.email ?? null);
      setAuthState("loggedIn");

      try {
        const res = await fetch("/api/theater/me", { cache: "no-store" });
        if (res.status === 401) {
          setMe(null);
          setMeCheckStatus("error");
          setMeCheckMessage(
            "ログイン状態はありますが、サーバー側でセッションが確認できません。ログアウト→再ログイン後に再度お試しください。"
          );
          return;
        }
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as
            | MeResponse
            | null;
          setMeCheckStatus("error");
          setMeCheckMessage(
            json?.error?.message ?? "ログイン状態の確認に失敗しました。"
          );
          return;
        }
        const json = (await res.json()) as MeResponse;
        setMe(json.data ?? null);
        if (json.data?.member?.role === "owner") {
          const membersRes = await fetch("/api/theater/members", {
            cache: "no-store",
          });
          if (membersRes.ok) {
            const membersJson = (await membersRes.json()) as {
              data?: { members: { user_id: string; role: string; email: string }[] };
            };
            setMembers(membersJson.data?.members ?? []);
          }
        } else {
          setMembers([]);
        }
        setMeCheckStatus("ok");
      } catch {
        setMeCheckStatus("error");
        setMeCheckMessage("ネットワークエラーで確認に失敗しました。");
      }
    };

    refreshAuth();
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
    setOnboardMessage("劇団情報を送信しました。すぐに公演を作成できます。");
    setOnboarding(false);
  };

  const submitInvite = async () => {
    setInviteStatus("loading");
    setInviteMessage(null);
    const res = await fetch("/api/theater/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const json = (await res.json()) as {
      error?: { message: string };
    };
    if (!res.ok) {
      setInviteStatus("error");
      setInviteMessage(json.error?.message ?? "招待に失敗しました");
      return;
    }
    setInviteStatus("sent");
    setInviteMessage("招待メールを追加しました。");
    setInviteEmail("");

    // re-fetch latest state (counts and invites)
    try {
      const refreshed = await fetch("/api/theater/me", { cache: "no-store" });
      const refreshedJson = (await refreshed.json()) as MeResponse;
      setMe(refreshedJson.data ?? null);
      if (refreshedJson.data?.member?.role === "owner") {
        const membersRes = await fetch("/api/theater/members", {
          cache: "no-store",
        });
        if (membersRes.ok) {
          const membersJson = (await membersRes.json()) as {
            data?: { members: { user_id: string; role: string; email: string }[] };
          };
          setMembers(membersJson.data?.members ?? []);
        }
      } else {
        setMembers([]);
      }
    } catch {
      // ignore
    }
  };

  const removeInvite = async (inviteId: string) => {
    setInviteRemoveId(inviteId);
    setInviteMessage(null);
    const res = await fetch("/api/theater/invite", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteId }),
    });
    const json = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setInviteStatus("error");
      setInviteMessage(json.error?.message ?? "招待の削除に失敗しました");
      setInviteRemoveId(null);
      return;
    }
    setInviteStatus("sent");
    setInviteMessage("招待を削除しました。");
    setInviteRemoveId(null);
    try {
      const refreshed = await fetch("/api/theater/me", { cache: "no-store" });
      const refreshedJson = (await refreshed.json()) as MeResponse;
      setMe(refreshedJson.data ?? null);
    } catch {}
  };

  const removeMember = async (userId: string) => {
    setMemberRemoveId(userId);
    setInviteMessage(null);
    const res = await fetch("/api/theater/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const json = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      setInviteStatus("error");
      setInviteMessage(json.error?.message ?? "メンバーの削除に失敗しました");
      setMemberRemoveId(null);
      return;
    }
    setInviteStatus("sent");
    setInviteMessage("メンバーを削除しました。");
    setMemberRemoveId(null);
    try {
      const refreshed = await fetch("/api/theater/me", { cache: "no-store" });
      const refreshedJson = (await refreshed.json()) as MeResponse;
      setMe(refreshedJson.data ?? null);
      if (refreshedJson.data?.member?.role === "owner") {
        const membersRes = await fetch("/api/theater/members", {
          cache: "no-store",
        });
        if (membersRes.ok) {
          const membersJson = (await membersRes.json()) as {
            data?: { members: { user_id: string; role: string; email: string }[] };
          };
          setMembers(membersJson.data?.members ?? []);
        }
      }
    } catch {}
  };


  const totalInUse =
    (me?.stats?.memberCount ?? 0) + (me?.stats?.inviteCount ?? 0);
  const limitReached =
    me?.stats?.totalAllowed !== undefined &&
    totalInUse >= me.stats.totalAllowed;

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
        {meCheckStatus === "checking" && (
          <div className="mt-1 text-xs text-zinc-500">
            サーバー側の状態を確認しています...
          </div>
        )}
        {meCheckStatus === "error" && meCheckMessage && (
          <div className="mt-2 text-xs text-red-600">{meCheckMessage}</div>
        )}
        {userEmail && (
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              location.href = "/register";
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
          劇団: {me.theater.name} / ステータス:{" "}
          {getTheaterStatusCopy(me.theater.status).label}
        </div>
        {me.joinedFromInvite && (
          <div className="mt-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-700">
            招待メールで登録されました。劇団メンバーとして有効になりました。
          </div>
        )}
        {me.stats && (
          <div className="mt-1 text-xs text-zinc-600">
            登録メール数（メンバー + 招待）: {totalInUse}/
            {me.stats.totalAllowed ?? 2}
          </div>
          )}
          <a
            href="/theater"
            className="mt-3 inline-block text-sm font-medium text-zinc-900 underline"
          >
            劇団ダッシュボードへ
          </a>
          <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-sm font-semibold">2人目のメールを追加</div>
            <p className="mt-1 text-xs text-zinc-600">
              この劇団にログインできるメールは最大2件までです。
            </p>
            {me.stats && (
              <p className="mt-1 text-xs text-zinc-500">
                現在: {totalInUse}/{me.stats.totalAllowed ?? 2}
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                className="flex-1 rounded-md border border-zinc-200 px-3 py-2 text-sm"
                placeholder="追加するメールアドレス"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={limitReached}
              />
              <button
                onClick={submitInvite}
                disabled={!inviteEmail || inviteStatus === "loading" || limitReached}
                className="rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {inviteStatus === "loading" ? "追加中..." : "追加する"}
              </button>
            </div>
            {limitReached && (
              <p className="mt-2 text-xs text-red-600">
                上限に達しています。既存の招待を消化（ログイン）するか、運営にて手動で調整してください。
              </p>
            )}
            {inviteMessage && (
              <p
                className={`mt-2 text-xs ${
                  inviteStatus === "error" ? "text-red-600" : "text-green-600"
                }`}
              >
                {inviteMessage}
              </p>
            )}
            <p className="mt-2 text-xs text-zinc-500">
              追加されたメールでログインすると自動的にこの劇団に紐づきます。
              招待メールは送られません。ログインできない場合はここから削除→再追加してください。
            </p>
            {me.invites && me.invites.length > 0 && (
              <div className="mt-3 space-y-1 text-xs text-zinc-600">
                <div className="font-semibold text-zinc-700">招待の状況</div>
                {me.invites.map((inv) => (
                  <div
                    key={inv.id}
                    className="rounded-md border border-zinc-200 bg-white px-3 py-2"
                  >
                    <div className="font-medium">{inv.email}</div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-1 ${getInviteStatusCopy(inv.status).bg} ${getInviteStatusCopy(inv.status).tone}`}
                      >
                        {getInviteStatusCopy(inv.status).label}
                      </span>
                      {inv.status === "pending" && (
                        <button
                          onClick={() => removeInvite(inv.id)}
                          disabled={inviteRemoveId === inv.id}
                          className="text-red-600 hover:underline disabled:opacity-50"
                        >
                          {inviteRemoveId === inv.id ? "削除中..." : "削除"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 space-y-2 text-xs text-zinc-600">
              <div className="font-semibold text-zinc-700">現在のメンバー</div>
              {members.length === 0 && (
                <div className="rounded-md border border-dashed border-zinc-200 bg-white px-3 py-2 text-[12px] text-zinc-500">
                  まだメンバーは登録されていません。
                </div>
              )}
              {members.map((m) => (
                <div
                  key={m.user_id}
                  className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2"
                >
                  <div>
                    <div className="font-medium">{m.email}</div>
                    <div className="text-[11px] text-zinc-500">
                      役割: {m.role}
                    </div>
                  </div>
                  {m.role !== "owner" && (
                    <button
                      onClick={() => removeMember(m.user_id)}
                      disabled={memberRemoveId === m.user_id}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      {memberRemoveId === m.user_id ? "削除中..." : "削除"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
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

      {authState === "loggedIn" && !me?.theater && me?.pendingInvite && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          追加済みのメールでログインしました。劇団メンバー登録を有効化しています…
          もしこのまま進まない場合は、ページを再読み込みするか、もう一度ログインしてください。
        </div>
      )}

      {authState === "loggedIn" && !me?.theater && (
        <div className="mt-8 rounded-lg border border-zinc-200 p-4">
          <h2 className="text-lg font-semibold">劇団情報の登録</h2>
          <p className="mt-1 text-sm text-zinc-600">
            登録後すぐに公演の作成・公開ができます。
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
